import { cohereProvider } from "./cohere";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { openrouterProvider } from "./openrouter";
import { puterProvider } from "./puter";
import { ProviderError, type ChatProvider, type ModelInfo } from "./types";

export * from "./types";

/** Registry. Adding a provider = one module + one line here. */
const REGISTRY: ChatProvider[] = [
  openrouterProvider,
  groqProvider,
  geminiProvider,
  cohereProvider,
  puterProvider,
];

export const DEFAULT_PROVIDER = "openrouter";
export const DEFAULT_MODEL = "openrouter/free";

export function getProvider(id: string): ChatProvider {
  const provider = REGISTRY.find((p) => p.id === id);
  if (!provider) {
    // The requested id is echoed to the log only, never back to the caller.
    console.error(`[ugnay] Unknown provider requested: "${id}".`);
    throw new ProviderError("That model is not available.", 400);
  }
  return provider;
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  configured: boolean;
  models: ModelInfo[];
}

/**
 * Server-side only: reads env vars to decide which providers are usable.
 * The catalog is handed to the client via `/api/models` — it contains no keys.
 */
export function listCatalog(): ProviderCatalogEntry[] {
  return REGISTRY.map((p) => ({
    id: p.id,
    label: p.label,
    configured: p.isConfigured(),
    models: p.listModels(),
  }));
}

/** Falls back to the default free model if the requested pair is unusable. */
export function resolveModel(providerId: string, modelId: string) {
  const provider = REGISTRY.find((p) => p.id === providerId);
  if (!provider || !provider.isConfigured()) {
    const fallback = getProvider(DEFAULT_PROVIDER);
    if (!fallback.isConfigured()) {
      // Which key is missing is a server concern; the caller only learns that
      // no model can answer right now.
      console.error(
        `[ugnay] No AI provider is configured: ${DEFAULT_PROVIDER} has no API key set.`,
      );
      throw new ProviderError("No AI model is available right now. Please try again later.", 503);
    }
    return { provider: fallback, model: DEFAULT_MODEL };
  }
  const known = provider.listModels().some((m) => m.id === modelId);
  return { provider, model: known ? modelId : provider.listModels()[0].id };
}
