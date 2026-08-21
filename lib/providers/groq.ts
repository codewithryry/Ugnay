import { streamOpenAICompatible } from "./openai-compatible";
import { ProviderError, type ChatProvider, type ChatRequest, type ModelInfo } from "./types";

/**
 * Groq speaks the OpenAI dialect. Inactive until GROQ_API_KEY is set on the
 * server — unconfigured providers are filtered out of the model selector.
 */
const MODELS: ModelInfo[] = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Groq)", free: true, capabilities: ["text"] },
];

export const groqProvider: ChatProvider = {
  id: "groq",
  label: "Groq",
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),
  listModels: () => MODELS,
  streamChat(req: ChatRequest) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("[ugnay] groq is not configured: GROQ_API_KEY is not set.");
      throw new ProviderError("This model is unavailable right now.", 500, "groq");
    }
    return streamOpenAICompatible({
      providerId: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey,
      req,
    });
  },
};
