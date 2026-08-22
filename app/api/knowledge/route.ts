import { NextResponse, type NextRequest } from "next/server";
import { chunkTextWithTotal, extractText } from "@/lib/knowledge";
import { MAX_FILE_BYTES, typeFor } from "@/lib/knowledge-types";
import {
  currentEmbeddingModel,
  embedBatch,
  isExpectedDimension,
  toVectorLiteral,
} from "@/lib/providers/embeddings";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Extracting and embedding a long document takes a while. */
export const maxDuration = 60;

const BUCKET = "knowledge";

/** Uploads allowed per account per minute. */
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60_000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface IndexResult {
  chunks: number;
  total: number;
  error: string | null;
}

/**
 * Embeds a file's text and replaces its passages.
 *
 * Shared by the upload and the re-index paths, so a retry runs exactly the same
 * indexing the first attempt did. Existing passages are cleared first, which is
 * what makes it safe to call twice — a half-finished index does not accumulate
 * duplicates.
 */
async function indexFile(
  supabase: Supabase,
  userId: string,
  fileId: string,
  text: string,
): Promise<IndexResult> {
  const started = Date.now();
  const { chunks, total } = chunkTextWithTotal(text);

  if (chunks.length === 0) {
    const error = "There was no text to index.";
    await supabase
      .from("files")
      .update({ indexed_at: null, index_error: error, chunk_count: 0, total_chunks: 0 })
      .eq("id", fileId);
    return { chunks: 0, total: 0, error };
  }

  const intended = currentEmbeddingModel();
  if (!intended) {
    const error = "No embedding provider is configured, so this file cannot be indexed.";
    await supabase.from("files").update({ index_error: error }).eq("id", fileId);
    return { chunks: 0, total, error };
  }

  /**
   * Passages already stored for this file. A chunk whose text and model both
   * match is kept as it is — re-embedding it would spend a request to arrive at
   * the same vector, which is what makes a retry after a partial run cheap.
   */
  const { data: existingRows } = await supabase
    .from("file_chunks")
    .select("chunk_index, content, embedding_model")
    .eq("file_id", fileId);

  const existing = new Map<number, { content: string; embedding_model: string | null }>();
  for (const row of existingRows ?? []) existing.set(row.chunk_index, row);

  const reusable = (model: string) =>
    new Set(
      chunks
        .map((content, index) => ({ content, index }))
        .filter(({ content, index }) => {
          const prior = existing.get(index);
          return Boolean(prior && prior.content === content && prior.embedding_model === model);
        })
        .map(({ index }) => index),
    );

  let keep = reusable(intended);
  let pending = chunks.map((content, index) => ({ content, index })).filter((c) => !keep.has(c.index));

  let embedded = new Map<number, number[]>();
  let usedModel = intended;

  if (pending.length > 0) {
    const result = await embedBatch(
      pending.map((c) => c.content),
      "search_document",
    );

    /**
     * A fallback landed on a different model. Vectors from two models cannot be
     * compared, so the kept passages are no longer usable alongside the new
     * ones: drop the reuse and embed the whole file with the model that
     * actually answered. Necessary re-embedding, not wasted work.
     */
    if (result.model && result.model !== intended && keep.size > 0) {
      console.log(
        `[ugnay] knowledge: fell back to ${result.model}; re-embedding ${keep.size} ` +
          `passage(s) that were on ${intended} so the file stays on one model.`,
      );
      keep = new Set();
      pending = chunks.map((content, index) => ({ content, index }));
      const redo = await embedBatch(
        pending.map((c) => c.content),
        "search_document",
      );
      usedModel = redo.model ?? result.model;
      redo.vectors.forEach((vector, n) => {
        if (vector) embedded.set(pending[n].index, vector);
      });
    } else {
      usedModel = result.model ?? intended;
      result.vectors.forEach((vector, n) => {
        if (vector) embedded.set(pending[n].index, vector);
      });
    }
  }

  const rows = [...embedded.entries()]
    // Belt and braces: the registry only holds same-size providers, but a
    // wrong-size vector must never reach a vector(1024) column.
    .filter(([, vector]) => isExpectedDimension(vector))
    .map(([index, vector]) => ({
      file_id: fileId,
      user_id: userId,
      chunk_index: index,
      content: chunks[index],
      embedding: toVectorLiteral(vector),
      embedding_model: usedModel,
    }));

  const stored = rows.length + keep.size;

  if (stored === 0) {
    const error = "No embedding provider could index this file. Retry to try again.";
    await supabase
      .from("files")
      .update({ indexed_at: null, index_error: error, chunk_count: 0, total_chunks: total })
      .eq("id", fileId);
    return { chunks: 0, total, error };
  }

  /**
   * Remove only what is being replaced or is no longer part of the document:
   * the kept passages stay untouched. Reached once there is something to put in
   * their place, so a failed pass never destroys a working index.
   */
  const doomed = [...existing.keys()].filter((index) => !keep.has(index));
  if (doomed.length > 0) {
    const { error: clearError } = await supabase
      .from("file_chunks")
      .delete()
      .eq("file_id", fileId)
      .in("chunk_index", doomed);
    if (clearError) console.error("[ugnay] Could not clear replaced passages:", clearError);
  }

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("file_chunks").insert(rows);
    if (insertError) {
      console.error("[ugnay] Could not store the passages:", insertError);
      const error = "Could not index this file. Please try again.";
      await supabase
        .from("files")
        .update({ indexed_at: null, index_error: error, chunk_count: 0, total_chunks: total })
        .eq("id", fileId);
      return { chunks: 0, total, error };
    }
  }

  /**
   * Two different kinds of "not everything got in", which must not be reported
   * as one:
   *
   *  - `capped`: the document is longer than MAX_CHUNKS_PER_FILE. Permanent and
   *    by design, so it is stated plainly and there is nothing to retry.
   *  - `failed`: an embedding did not come back even after its retries. That is
   *    transient, so it is recorded as an error the user can act on rather than
   *    being dressed up as an intentional partial index.
   */
  const capped = total > chunks.length;
  const failed = chunks.length - stored;
  const error =
    failed > 0
      ? `${failed} of ${chunks.length} passages could not be embedded. Retry to index the rest.`
      : null;

  await supabase
    .from("files")
    .update({
      // What did get in is usable, so the file counts as indexed either way.
      indexed_at: new Date().toISOString(),
      index_error: error,
      chunk_count: stored,
      total_chunks: total,
      embedding_model: usedModel,
    })
    .eq("id", fileId);

  console.log(
    `[ugnay] knowledge: indexed ${stored}/${total} passages for ${fileId} ` +
      `via ${usedModel} in ${Date.now() - started}ms` +
      `${keep.size > 0 ? ` (${keep.size} reused)` : ""}` +
      `${capped ? " (capped)" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`,
  );

  return { chunks: stored, total, error };
}

/**
 * Knowledge uploads.
 *
 * POST stores the original in the private `knowledge` bucket, records it in
 * `files`, then extracts its text, splits it into passages and embeds each one
 * into `file_chunks` so `/api/chat` can recall them. PATCH re-runs that
 * indexing for a file that failed or finished only in part. DELETE removes all
 * three.
 *
 * Kept on the server because it holds the embedding provider's key. Ownership
 * is the authenticated user's id, and RLS plus the storage policy enforce it a
 * second time.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/knowledge could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const limit = rateLimit(`knowledge:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }

  const name = file.name.trim().slice(0, 255);
  if (!name) return NextResponse.json({ error: "That file has no name." }, { status: 400 });

  const type = typeFor(name);
  if (!type) {
    return NextResponse.json({ error: "That file type is not supported." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `Keep files under ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Namespaced by user id: the storage policy checks that first path segment,
  // so an object can never be written into another account's folder.
  const storagePath = `${user.id}/${crypto.randomUUID()}-${name.replace(/[^\w.\-]+/g, "_")}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.error("[ugnay] /api/knowledge could not store the file:", uploadError);
    return NextResponse.json(
      {
        error:
          "Could not store this file. If this is a new deployment, re-run supabase/schema.sql so the knowledge bucket exists.",
      },
      { status: 500 },
    );
  }

  const extraction = extractText(name, bytes);

  const { data: record, error: insertError } = await supabase
    .from("files")
    .insert({
      user_id: user.id,
      bucket: BUCKET,
      storage_path: storagePath,
      name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      extracted_text: extraction.text || null,
      index_error: extraction.error,
    })
    .select("*")
    .single();

  if (insertError || !record) {
    // Don't leave an orphan object behind in the bucket.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    console.error("[ugnay] /api/knowledge could not record the file:", insertError);
    return NextResponse.json({ error: "Could not save this file." }, { status: 500 });
  }

  // No readable text: the file is kept and listed, with the reason attached.
  if (!extraction.text) {
    return NextResponse.json({ file: record, chunks: 0, warning: extraction.error });
  }

  const result = await indexFile(supabase, user.id, record.id, extraction.text);

  return NextResponse.json({
    file: {
      ...record,
      indexed_at: result.error ? null : new Date().toISOString(),
      index_error: result.error,
      chunk_count: result.chunks,
      total_chunks: result.total,
    },
    chunks: result.chunks,
    total: result.total,
    warning:
      result.error ??
      (result.chunks < result.total
        ? `Only the first ${result.chunks} of ${result.total} passages were indexed. The rest of this file will not be used for answers.`
        : null),
  });
}

/**
 * Re-indexes one file.
 *
 * The retry path for a file that failed, timed out mid-run, or was indexed only
 * in part. The stored text is reused when it is there; otherwise the original is
 * read back from the bucket and extracted again, so a run that died before the
 * text was saved can still recover.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/knowledge could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const limit = rateLimit(`knowledge:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // Scoped by user id as well as RLS.
  const { data: record, error: readError } = await supabase
    .from("files")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) console.error("[ugnay] /api/knowledge could not read the file:", readError);
  if (!record) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const type = typeFor(record.name);
  if (type && !type.readable) {
    return NextResponse.json(
      { error: `${type.label} text cannot be indexed yet, so there is nothing to retry.` },
      { status: 400 },
    );
  }

  let text: string = record.extracted_text ?? "";

  // No stored text: read the original back and extract it again.
  if (!text) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from(record.bucket)
      .download(record.storage_path);

    if (downloadError || !blob) {
      console.error("[ugnay] Could not read the stored file back:", downloadError);
      return NextResponse.json(
        { error: "Could not read this file back from storage." },
        { status: 500 },
      );
    }

    const extraction = extractText(record.name, Buffer.from(await blob.arrayBuffer()));
    if (!extraction.text) {
      await supabase.from("files").update({ index_error: extraction.error }).eq("id", record.id);
      return NextResponse.json(
        { file: { ...record, index_error: extraction.error }, chunks: 0, warning: extraction.error },
        { status: 200 },
      );
    }
    text = extraction.text;
    await supabase.from("files").update({ extracted_text: text }).eq("id", record.id);
  }

  const result = await indexFile(supabase, user.id, record.id, text);

  return NextResponse.json({
    file: {
      ...record,
      extracted_text: text,
      indexed_at: result.error ? null : new Date().toISOString(),
      index_error: result.error,
      chunk_count: result.chunks,
      total_chunks: result.total,
    },
    chunks: result.chunks,
    total: result.total,
    warning:
      result.error ??
      (result.chunks < result.total
        ? `Only the first ${result.chunks} of ${result.total} passages were indexed.`
        : null),
  });
}

/** Removes one file: its passages, its row, and the stored original. */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // Scoped by user id as well as RLS, so the path below is always the caller's.
  const { data: record, error: readError } = await supabase
    .from("files")
    .select("id, bucket, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) console.error("[ugnay] /api/knowledge could not read the file:", readError);
  if (!record) return NextResponse.json({ error: "File not found." }, { status: 404 });

  // file_chunks cascades from files, so deleting the row clears the index.
  const { error: deleteError } = await supabase.from("files").delete().eq("id", record.id);
  if (deleteError) {
    console.error("[ugnay] /api/knowledge could not delete the file:", deleteError);
    return NextResponse.json({ error: "Could not delete this file." }, { status: 500 });
  }

  const { error: removeError } = await supabase.storage
    .from(record.bucket)
    .remove([record.storage_path]);
  // The row is already gone, so a failure here only leaves an unreferenced
  // object. Worth logging, not worth failing the request the user asked for.
  if (removeError) console.error("[ugnay] Could not remove the stored file:", removeError);

  return NextResponse.json({ ok: true });
}
