/**
 * Server-side embeddings.
 *
 * A small registry in the same shape as the chat providers in ./index.ts:
 * adding a provider is one object plus one line in REGISTRY, and a provider
 * with no key configured is skipped. Keys are read from the environment on
 * every call and never leave this module, so none can reach the browser.
 *
 * Two rules the rest of the app depends on:
 *
 *  - Every provider here MUST return EMBEDDING_DIMENSIONS values. Vectors from
 *    two different models are not comparable, so a fallback to a model of a
 *    different size would silently poison every later search. Same-size is the
 *    minimum bar; the model each vector came from is recorded alongside it and
 *    searches are scoped to one model.
 *  - A rate-limited provider is abandoned for the next one immediately. Sitting
 *    on a 429 and asking again is how passages went missing.
 */

/** The width of the `vector(1024)` columns in supabase/schema.sql. */
export const EMBEDDING_DIMENSIONS = 1024;

/** Longest input we embed. Keeps a single call cheap and predictable. */
const MAX_INPUT_CHARS = 4000;

export type EmbeddingInputType = "search_query" | "search_document";

export interface EmbeddingProvider {
  id: string;
  label: string;
  /** Fully-qualified model id, stored with every vector it produces. */
  model: string;
  /** Must equal EMBEDDING_DIMENSIONS; asserted before any vector is used. */
  dimensions: number;
  /** Texts accepted in one request. Batching is what keeps us off rate limits. */
  maxBatch: number;
  /** False when the required server-side API key is missing. */
  isConfigured(): boolean;
  /** Embeds a batch in order. Throws EmbeddingError; never returns partial. */
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
    /** True for a rate limit or an outage: try a different provider. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 504);
}

/**
 * Cohere's embed endpoint, called with fetch rather than the `cohere-ai` SDK —
 * the same reasoning as lib/providers/cohere.ts, which uses their
 * OpenAI-compatible chat endpoint instead of the SDK.
 *
 * The v3 models return 1,024 values and take the same search_query /
 * search_document distinction the callers already pass, so the mapping is
 * direct. Up to 96 texts per request.
 */
function cohereEmbedding(model: string, label: string): EmbeddingProvider {
  return {
    id: `cohere:${model}`,
    label,
    model: `cohere/${model}`,
    dimensions: 1024,
    maxBatch: 96,

    isConfigured() {
      return Boolean(process.env.COHERE_API_KEY);
    },

    async embed(texts, inputType) {
      const apiKey = process.env.COHERE_API_KEY;
      if (!apiKey) {
        throw new EmbeddingError("Cohere is not configured.", 500, this.id, false);
      }

      let res: Response;
      try {
        res = await fetch("https://api.cohere.com/v2/embed", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            input_type: inputType,
            embedding_types: ["float"],
            texts,
          }),
        });
      } catch {
        throw new EmbeddingError("Could not reach Cohere.", 502, this.id, true);
      }

      if (!res.ok) {
        // Logged, never returned: an upstream body can name the account.
        const detail = await res.text().catch(() => "");
        console.error(`[ugnay] ${this.id} embed ${res.status}: ${detail.slice(0, 300)}`);
        throw new EmbeddingError(
          res.status === 429 ? "Cohere is rate limiting embeddings." : "Cohere could not embed.",
          res.status,
          this.id,
          isRetryableStatus(res.status),
        );
      }

      const body = (await res.json().catch(() => null)) as {
        embeddings?: { float?: number[][] };
      } | null;
      const vectors = body?.embeddings?.float;

      if (!Array.isArray(vectors) || vectors.length !== texts.length) {
        throw new EmbeddingError("Cohere returned an unusable response.", 502, this.id, true);
      }
      return vectors;
    },
  };
}

/**
 * Fallback order. Both entries are 1,024-dimension Cohere v3 models, so a
 * switch between them keeps vectors comparable in size — the model id is still
 * recorded per vector, and searches stay within one model.
 *
 * A new provider belongs here only if it returns EMBEDDING_DIMENSIONS values.
 */
const REGISTRY: EmbeddingProvider[] = [
  cohereEmbedding("embed-multilingual-v3.0", "Cohere Embed Multilingual v3"),
  cohereEmbedding("embed-english-v3.0", "Cohere Embed English v3"),
];

/** Providers with a key set, in fallback order. */
export function embeddingProviders() {
  return REGISTRY.filter((p) => p.isConfigured() && p.dimensions === EMBEDDING_DIMENSIONS);
}

export function embeddingsConfigured() {
  return embeddingProviders().length > 0;
}

/** The model new vectors will be written with, or null when none is usable. */
export function currentEmbeddingModel(): string | null {
  return embeddingProviders()[0]?.model ?? null;
}

function prepare(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
}

export interface BatchResult {
  /** One entry per input, null where every provider failed for that batch. */
  vectors: (number[] | null)[];
  /** The model that produced the vectors, or null when none succeeded. */
  model: string | null;
}

/**
 * Embeds many texts, walking the registry until one provider gets through.
 *
 * A provider is given the whole job: batching within it, then the next provider
 * on a rate limit or an outage. That is deliberate — mixing two models across
 * one document would leave it unsearchable as a whole, so the fallback replaces
 * the provider for the entire call rather than per batch.
 */
export async function embedBatch(
  texts: string[],
  inputType: EmbeddingInputType = "search_document",
): Promise<BatchResult> {
  const inputs = texts.map(prepare);
  const usable = inputs.map((t) => t.length > 0);
  if (!usable.some(Boolean)) return { vectors: texts.map(() => null), model: null };

  const providers = embeddingProviders();
  if (providers.length === 0) {
    console.error("[ugnay] Embeddings skipped: no embedding provider is configured.");
    return { vectors: texts.map(() => null), model: null };
  }

  for (const provider of providers) {
    const out: (number[] | null)[] = texts.map(() => null);
    // Index in `texts` for each non-empty input, so results map back exactly.
    const targets = inputs.map((_, i) => i).filter((i) => usable[i]);
    let failed = false;

    for (let at = 0; at < targets.length && !failed; at += provider.maxBatch) {
      const slice = targets.slice(at, at + provider.maxBatch);
      try {
        const vectors = await provider.embed(
          slice.map((i) => inputs[i]),
          inputType,
        );

        vectors.forEach((vector, n) => {
          if (Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS) {
            out[slice[n]] = vector;
          } else {
            console.error(
              `[ugnay] ${provider.id} returned ${vector?.length ?? 0} dimensions; ` +
                `${EMBEDDING_DIMENSIONS} required.`,
            );
          }
        });
      } catch (err) {
        const error = err as EmbeddingError;
        console.error(
          `[ugnay] ${provider.id} failed (${error.status ?? "?"}); ` +
            `${error.retryable ? "falling back to the next provider" : "giving up on it"}.`,
        );
        // Whether or not it looks retryable, the next provider is the answer —
        // never the same rate-limited one again.
        failed = true;
      }
    }

    if (!failed && out.some(Boolean)) return { vectors: out, model: provider.model };
  }

  return { vectors: texts.map(() => null), model: null };
}

/**
 * Embeds one string. Returns null instead of throwing: embeddings power an
 * optional memory feature, so a provider outage must never fail a chat turn.
 *
 * Kept for the single-query callers; it is `embedBatch` with one input, so it
 * gets the same provider fallback.
 */
export async function embedText(
  text: string,
  inputType: EmbeddingInputType = "search_document",
): Promise<number[] | null> {
  const { vectors } = await embedBatch([text], inputType);
  return vectors[0] ?? null;
}

/** As above, but reports which model answered so a search can be scoped to it. */
export async function embedQuery(
  text: string,
): Promise<{ vector: number[] | null; model: string | null }> {
  const { vectors, model } = await embedBatch([text], "search_query");
  return { vector: vectors[0] ?? null, model };
}

/** True when a vector matches the column the schema declares. */
export function isExpectedDimension(vector: number[]) {
  return vector.length === EMBEDDING_DIMENSIONS;
}

/** pgvector accepts its literal form as text, which PostgREST can carry. */
export function toVectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}
