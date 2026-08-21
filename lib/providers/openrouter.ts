import { streamOpenAICompatible } from "./openai-compatible";
import { ProviderError, type ChatProvider, type ChatRequest, type ModelInfo } from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Free-tier models only for the MVP. `openrouter/free` is OpenRouter's free
 * router (it picks a suitable free model); the rest are explicit alternatives
 * so no single model is a hard dependency.
 */
const MODELS: ModelInfo[] = [
  {
    id: "openrouter/free",
    label: "Auto",
    description: "Routes to a suitable free model automatically.",
    free: true,
    capabilities: ["text"],
  },
  {
    id: "z-ai/glm-5.2:free",
    label: "GLM 5.2",
    description: "Strong general-purpose reasoning.",
    free: true,
    capabilities: ["text"],
  },
  {
    id: "poolside/laguna-s-2.1:free",
    label: "Laguna S 2.1",
    description: "Code-focused model.",
    free: true,
    capabilities: ["text"],
  },
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B",
    description: "Balanced everyday assistant.",
    free: true,
    capabilities: ["text"],
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B A4B",
    description: "Lightweight, quick responses.",
    free: true,
    capabilities: ["text"],
  },
];

export const openrouterProvider: ChatProvider = {
  id: "openrouter",
  label: "OpenRouter",

  isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  listModels() {
    return MODELS;
  },

  streamChat(req: ChatRequest) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error("[ugnay] openrouter is not configured: OPENROUTER_API_KEY is not set.");
      throw new ProviderError("This model is unavailable right now.", 500, "openrouter");
    }

    return streamOpenAICompatible({
      providerId: "openrouter",
      baseUrl: BASE_URL,
      apiKey,
      headers: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_APP_NAME ?? "Ugnay",
      },
      req,
      // OpenRouter understands `reasoning` and `plugins`, so both toggles can be
      // switched off explicitly rather than merely left unset.
      supportsExtras: true,
    });
  },
};
