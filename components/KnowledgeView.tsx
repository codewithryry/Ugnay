"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  PanelLeft,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { describeDbError, isMissingDbObject } from "@/lib/supabase/errors";
import { ACCEPT_ATTRIBUTE, SUPPORTED_TYPES, typeFor } from "@/lib/knowledge-types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import type { KnowledgeFile } from "@/types/db";
import { apiFetch } from "@/lib/api";

/** Shown when the tables this feature needs are not in the database yet. */
const MIGRATION_HINT =
  "Knowledge needs the latest database migration. Re-run supabase/schema.sql in the Supabase SQL editor.";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when the cap stopped indexing short of the whole document. */
function partialFor(file: KnowledgeFile) {
  return Boolean(
    file.indexed_at && file.total_chunks && file.chunk_count && file.chunk_count < file.total_chunks,
  );
}

/**
 * True when the file's passages were embedded by a model that is no longer the
 * one in use. Those vectors are not comparable to a new query, so the file is
 * effectively out of the knowledge base until it is re-indexed. Nothing is
 * deleted on its behalf — re-indexing is the user's call.
 */
function staleModel(file: KnowledgeFile, current: string | null) {
  if (!file.indexed_at || !current) return false;
  return file.embedding_model !== current;
}

/**
 * Whether re-indexing could change anything: it never ran, it left a recorded
 * error, or its vectors are from a retired model. A file that is short of its
 * full length only because of the chunk cap is NOT retryable — the cap applies
 * every time — and a format whose text cannot be read has nothing to retry.
 */
function canRetry(file: KnowledgeFile, current: string | null) {
  const type = typeFor(file.name);
  if (type && !type.readable) return false;
  return !file.indexed_at || Boolean(file.index_error) || staleModel(file, current);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Knowledge: files this account uploaded, and the ones Ugnay can answer from.
 *
 * A main-area surface like /release-notes. The list is read straight from
 * Supabase under RLS; uploading and deleting go through /api/knowledge, which
 * holds the embedding provider's key and writes the passages that make a file
 * searchable.
 */
export default function KnowledgeView() {
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);

  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  /** Id of the file currently being re-indexed. */
  const [retrying, setRetrying] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await createClient()
      .from("files")
      .select("*")
      .order("created_at", { ascending: false });

    if (loadError) {
      console.error("[ugnay] Could not load knowledge files:", describeDbError(loadError));
      setError(isMissingDbObject(loadError) ? MIGRATION_HINT : "Could not load your files.");
    } else {
      setFiles((data ?? []) as KnowledgeFile[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(list: FileList | File[]) {
    const queue = Array.from(list);
    setError(null);
    setNotice(null);

    for (const file of queue) {
      setUploading(file.name);
      const form = new FormData();
      form.append("file", file);

      try {
        const res = await apiFetch("/api/knowledge", { method: "POST", body: form });
        const payload = await res.json().catch(() => null);

        if (!res.ok) {
          setError(payload?.error ?? `Could not upload ${file.name}.`);
          continue;
        }
        if (payload?.file) setFiles((all) => [payload.file as KnowledgeFile, ...all]);
        if (payload?.warning) setNotice(`${file.name}: ${payload.warning}`);
      } catch (err) {
        console.error("[ugnay] Upload failed:", err);
        setError(`Could not upload ${file.name}.`);
      }
    }

    setUploading(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  /**
   * Re-runs indexing for one file. The same path a failed or partly-indexed
   * upload needs: nothing is re-uploaded, the stored text (or the stored
   * original) is indexed again.
   */
  async function retry(file: KnowledgeFile) {
    if (retrying) return;
    setRetrying(file.id);
    setError(null);
    setNotice(null);

    try {
      const res = await apiFetch("/api/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: file.id }),
      });
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        setError(payload?.error ?? `Could not re-index ${file.name}.`);
      } else {
        if (payload?.file) {
          setFiles((all) =>
            all.map((f) => (f.id === file.id ? (payload.file as KnowledgeFile) : f)),
          );
        }
        if (payload?.warning) setNotice(`${file.name}: ${payload.warning}`);
      }
    } catch (err) {
      console.error("[ugnay] Re-index failed:", err);
      setError(`Could not re-index ${file.name}.`);
    }
    setRetrying(null);
  }

  async function remove(file: KnowledgeFile) {
    const previous = files;
    setFiles((all) => all.filter((f) => f.id !== file.id));

    const res = await apiFetch(`/api/knowledge?id=${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setFiles(previous);
      setError(`Could not delete ${file.name}.`);
    }
  }

  /**
   * The model new vectors are written with, inferred from the most recently
   * indexed file. Enough to spot the ones left behind by a provider change
   * without adding an endpoint just to report it.
   */
  const currentModel =
    files.find((f) => f.indexed_at && f.embedding_model)?.embedding_model ?? null;
  const indexedCount = files.filter((f) => f.indexed_at && !staleModel(f, currentModel)).length;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ink-950">
      {/* Matches the chat header, so the mobile sidebar toggle stays put. */}
      <header className="flex min-h-[3.5rem] shrink-0 items-center gap-1 px-2 pt-safe md:h-14 md:gap-2 md:px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open the sidebar"
          className="shrink-0 rounded-lg p-2.5 text-neutral-400 hover:bg-ink-850 hover:text-neutral-100 md:hidden"
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 pb-24 pt-6 sm:px-8 md:pt-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-100 sm:text-4xl">
            Knowledge
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-400">
            Upload the documents Ugnay should answer from. Their text is split into passages and
            indexed, and the relevant ones are recalled automatically while you chat.
            {indexedCount > 0 && (
              <>
                {" "}
                <span className="text-neutral-300">
                  {indexedCount} file{indexedCount === 1 ? "" : "s"} indexed.
                </span>
              </>
            )}
          </p>

          {/* ------------------------------------------------------ uploader */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
            }}
            className={cn(
              "mt-8 rounded-2xl border border-dashed px-5 py-8 text-center transition",
              dragging ? "border-accent/60 bg-ink-900" : "border-ink-700 bg-ink-900",
            )}
          >
            <Upload className="mx-auto h-5 w-5 text-neutral-500" aria-hidden />
            <p className="mt-3 text-sm text-neutral-300">Drop files here, or</p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={Boolean(uploading)}
              className="mt-3 rounded-xl bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Choose files
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void upload(e.target.files);
              }}
            />
            <p className="mx-auto mt-4 max-w-md text-xs leading-relaxed text-neutral-600">
              {SUPPORTED_TYPES.filter((t) => t.readable)
                .map((t) => `.${t.ext}`)
                .join(", ")}{" "}
              are indexed and used for answers. PDFs can be stored but their text cannot be read
              yet, so they are not searched.
            </p>
          </div>

          {uploading && (
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-neutral-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Indexing {uploading}…
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs leading-relaxed text-danger"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mt-5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-xs leading-relaxed text-warning"
            >
              {notice}
            </p>
          )}

          {/* ---------------------------------------------------------- list */}
          {loading ? (
            <div className="mt-10 space-y-2.5" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-ink-900" />
              ))}
            </div>
          ) : files.length === 0 ? (
            <p className="mt-10 text-center text-sm text-neutral-500">
              No files yet. Upload one above to start a knowledge base.
            </p>
          ) : (
            <ul className="mt-10 space-y-2.5">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-start gap-3 rounded-xl border border-ink-800 bg-ink-900 px-4 py-3.5"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-100">{file.name}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {formatSize(file.size_bytes)} · {formatDate(file.created_at)}
                    </p>
                    {staleModel(file, currentModel) ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          Indexed by an older embedding model, so it is not searched. Re-index to
                          bring it back.
                        </span>
                      </p>
                    ) : file.index_error ? (
                      /* A recorded failure. Checked first, because a file can be
                       * partly usable and still have passages that need a retry. */
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{file.index_error}</span>
                      </p>
                    ) : file.indexed_at && !partialFor(file) ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Indexed
                        {file.chunk_count ? ` · ${file.chunk_count} passages` : ""} — used for
                        answers
                      </p>
                    ) : file.indexed_at ? (
                      /* Indexed, but the cap stopped it short. Saying so is the
                       * whole point: it used to report as complete. */
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          Partly indexed — {file.chunk_count} of {file.total_chunks} passages. This
                          file is longer than the per-file limit, so the rest is not used for
                          answers.
                        </span>
                      </p>
                    ) : (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>{file.index_error ?? "Not indexed, so it is not searched."}</span>
                      </p>
                    )}
                  </div>
                  {/* Retry is offered whenever indexing did not finish. */}
                  {canRetry(file, currentModel) && (
                    <button
                      type="button"
                      onClick={() => void retry(file)}
                      disabled={retrying !== null}
                      aria-label={`Re-index ${file.name}`}
                      title="Re-index this file"
                      className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {retrying === file.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(file)}
                    aria-label={`Delete ${file.name}`}
                    className="shrink-0 rounded-md p-1.5 text-neutral-500 transition hover:bg-ink-800 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
