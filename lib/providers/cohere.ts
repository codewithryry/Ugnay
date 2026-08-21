import { streamOpenAICompatible } from "./openai-compatible";
import { ProviderError, type ChatProvider, type ChatRequest, type ModelInfo } from "./types";

/**
 * Cohere via its OpenAI-compatibility endpoint, so it reuses the shared
 * streaming client instead of pulling in the `cohere-ai` SDK. Inactive until
 * COHERE_API_KEY is set on the server.
 */
const MODELS: ModelInfo[] = [
  {
    id: "command-a-plus-05-2026",
    label: "Command A+",
    description: "Cohere's flagship instruction model.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "command-a-reasoning-08-2025",
    label: "Command A Reasoning",
    description: "Reasons before answering.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "command-a-03-2025",
    label: "Command A",
    description: "Balanced everyday assistant.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "north-mini-code-1-0",
    label: "North Mini Code",
    description: "Compact and fast for coding tasks.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "command-r7b-12-2024",
    label: "Command R7B",
    description: "Small and quick for short answers.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "c4ai-aya-expanse-32b",
    label: "Aya Expanse 32B",
    description: "Strong multilingual coverage.",
    free: false,
    capabilities: ["text"],
  },
];

export const cohereProvider: ChatProvider = {
  id: "cohere",
  label: "Cohere",
  isConfigured: () => Boolean(process.env.COHERE_API_KEY),
  listModels: () => MODELS,
  streamChat(req: ChatRequest) {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) {
      console.error("[ugnay] cohere is not configured: COHERE_API_KEY is not set.");
      throw new ProviderError("This model is unavailable right now.", 500, "cohere");
    }
    return streamOpenAICompatible({
      providerId: "cohere",
      baseUrl: "https://api.cohere.com/compatibility/v1",
      apiKey,
      req,
    });
  },
};
