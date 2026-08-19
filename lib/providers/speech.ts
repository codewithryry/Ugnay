import { OpenRouter } from "@openrouter/sdk";

/**
 * Server-side text-to-speech via OpenRouter. Like the embeddings module, the
 * key is read from the environment here and never reaches the browser.
 */

/** Free TTS model and one of its voices. */
export const SPEECH_MODEL = "deepgram/flux-tts:free";
export const SPEECH_VOICE = "flux-alexis-en";

/** Upper bound on a single utterance, so one click cannot run away. */
export const MAX_SPEECH_CHARS = 4000;

export function speechConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Streams synthesised audio for `text`. Throws when the provider rejects the
 * request so the caller can answer with a real status instead of silence.
 */
export async function createSpeechStream(text: string): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the server.");

  const openrouter = new OpenRouter({ apiKey });

  return openrouter.tts.createSpeech({
    speechRequest: {
      model: SPEECH_MODEL,
      input: text.slice(0, MAX_SPEECH_CHARS),
      voice: SPEECH_VOICE,
    },
    httpReferer: process.env.OPENROUTER_SITE_URL,
    appTitle: process.env.OPENROUTER_APP_NAME,
  });
}
