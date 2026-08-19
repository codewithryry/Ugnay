import { OpenRouter } from "@openrouter/sdk";

/**
 * Server-side embeddings via OpenRouter. The key is read from the environment
 * on every call and never leaves this module, so it cannot reach the browser.
 */

/** Free embedding model; 1,024 dimensions (see supabase/schema.sql). */
export const EMBEDDING_MODEL = "liquid/lfm-2.5-embedding-350m:free";
export const EMBEDDING_DIMENSIONS = 1024;

/** Longest input we embed. Keeps a single call cheap and predictable. */
const MAX_INPUT_CHARS = 4000;

let client: OpenRouter | null = null;

function getClient(): OpenRouter | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new OpenRouter({ apiKey });
  return client;
}

export function embeddingsConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Embeds one string. Returns null instead of throwing: embeddings power an
 * optional memory feature, so a provider outage must never fail a chat turn.
 */
export async function embedText(
  text: string,
  inputType: "search_query" | "search_document" = "search_document",
): Promise<number[] | null> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;

  const openrouter = getClient();
  if (!openrouter) {
    console.error("[ugnay] Embeddings skipped: OPENROUTER_API_KEY is not set.");
    return null;
  }

  try {
    const result = await openrouter.embeddings.generate({
      requestBody: { model: EMBEDDING_MODEL, input, inputType },
      httpReferer: process.env.OPENROUTER_SITE_URL,
      appTitle: process.env.OPENROUTER_APP_NAME,
    });

    // The response can be a raw string when a non-JSON encoding is requested.
    const vector = typeof result === "string" ? null : result.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      console.error("[ugnay] Embeddings returned no vector for the input.");
      return null;
    }
    return vector as number[];
  } catch (err) {
    console.error("[ugnay] Embedding request failed:", err);
    return null;
  }
}

/** pgvector accepts its literal form as text, which PostgREST can carry. */
export function toVectorLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}
