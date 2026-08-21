/**
 * Unified provider contract.
 *
 * Everything above this file (API route, UI, store) speaks only in these
 * types. Adding Groq / Gemini / Cohere means writing one module that
 * satisfies `ChatProvider` and registering it in `./index.ts` — no UI change.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ProviderMessage {
  role: ChatRole;
  content: string;
}

export interface ModelInfo {
  /** Fully-qualified id sent to the provider, e.g. "openrouter/free". */
  id: string;
  label: string;
  description?: string;
  /** Free to call — used to keep the MVP off paid models. */
  free: boolean;
  /** Reserved for vision/file support later. */
  capabilities?: Array<"text" | "vision" | "tools">;
}

export interface ChatRequest {
  model: string;
  messages: ProviderMessage[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  /**
   * Ask the model to reason before answering. Set only when the user turned
   * Thinking on; absent means the user turned it off, and a provider must then
   * ask its upstream to disable reasoning and must not emit `reasoning`
   * events. Providers with no reasoning support ignore it either way.
   */
  reasoning?: { effort: "low" | "medium" | "high" };
  /**
   * Let the provider search the web for this turn. Only true when the user
   * turned Web search on; false/absent means no web access at all — no search
   * plugin, no browsing tool, no online model variant.
   */
  webSearch?: boolean;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Events a provider stream yields. Providers normalise to this shape. */
export type StreamEvent =
  | { type: "delta"; text: string }
  /** Reasoning tokens, streamed separately from the answer. */
  | { type: "reasoning"; text: string }
  | { type: "usage"; usage: Usage }
  /**
   * End of the stream. `finishReason: "length"` means the reply was cut off
   * by the token cap rather than finished, so the caller can continue it.
   */
  | { type: "done"; finishReason?: "stop" | "length" };

export interface ChatProvider {
  id: string;
  label: string;
  /** False when the required server-side API key is missing. */
  isConfigured(): boolean;
  listModels(): ModelInfo[];
  streamChat(req: ChatRequest): AsyncIterable<StreamEvent>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly provider?: string,
    /** True when another model or a later attempt could succeed. */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Upstream statuses worth retrying on a different model. */
export function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 504);
}
