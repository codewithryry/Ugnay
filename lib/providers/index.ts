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

/**
 * Short-lived, in-process health record per provider/model pair. Everything
 * here is written from real traffic — an actual upstream error, or the time a
 * real stream took — so nothing is probed, guessed or simulated. A pair that
 * fails is skipped for a minute instead of failing every request, and the
 * admin AI Models page reads the same record.
 */
const UNAVAILABLE_MS = 60_000;

export interface ModelHealth {
  /** Millisecond latency of the last successful stream, if there was one. */
  latencyMs?: number;
  lastOkAt?: number;
  failures: number;
  lastErrorAt?: number;
  lastErrorStatus?: number;
  unavailableUntil?: number;
}

const health = new Map<string, ModelHealth>();
const pairKey = (providerId: string, model: string) => `${providerId}:${model}`;

function entry(providerId: string, model: string): ModelHealth {
  const key = pairKey(providerId, model);
  let record = health.get(key);
  if (!record) {
    record = { failures: 0 };
    health.set(key, record);
  }
  return record;
}

export function noteModelUnavailable(providerId: string, model: string, status?: number) {
  const record = entry(providerId, model);
  record.failures += 1;
  record.lastErrorAt = Date.now();
  record.lastErrorStatus = status;
  record.unavailableUntil = Date.now() + UNAVAILABLE_MS;
}

/** Records a stream that completed, so latency reflects real replies only. */
export function noteModelOk(providerId: string, model: string, latencyMs: number) {
  const record = entry(providerId, model);
  record.latencyMs = latencyMs;
  record.lastOkAt = Date.now();
  record.unavailableUntil = undefined;
}

export function isModelAvailable(providerId: string, model: string) {
  const until = health.get(pairKey(providerId, model))?.unavailableUntil;
  return until === undefined || until <= Date.now();
}

export function getModelHealth(providerId: string, model: string): ModelHealth {
  return health.get(pairKey(providerId, model)) ?? { failures: 0 };
}
