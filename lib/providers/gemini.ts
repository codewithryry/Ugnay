import { ProviderError, type ChatProvider, type ChatRequest, type ModelInfo, type StreamEvent } from "./types";

/**
 * Google Gemini uses its own wire format, so it normalises to `StreamEvent`
 * here rather than reusing the OpenAI-compatible helper. Inactive until
 * GEMINI_API_KEY is set on the server.
 */
const MODELS: ModelInfo[] = [
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", free: true, capabilities: ["text", "vision"] },
];

async function* stream(req: ChatRequest): AsyncIterable<StreamEvent> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError("GEMINI_API_KEY is not set on the server.", 500, "gemini");

  const systemParts = req.messages.filter((m) => m.role === "system").map((m) => ({ text: m.content }));
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    signal: req.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
      generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
    }),
  });

  if (!res.ok || !res.body) {
    throw new ProviderError(`Gemini responded with ${res.status}.`, res.status || 502, "gemini");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sep: number;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;

      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const text = parsed.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("");
      if (text) yield { type: "delta", text };

      if (parsed.usageMetadata) {
        yield {
          type: "usage",
          usage: {
            promptTokens: parsed.usageMetadata.promptTokenCount,
            completionTokens: parsed.usageMetadata.candidatesTokenCount,
            totalTokens: parsed.usageMetadata.totalTokenCount,
          },
        };
      }
    }
  }

  yield { type: "done" };
}

export const geminiProvider: ChatProvider = {
  id: "gemini",
  label: "Google Gemini",
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  listModels: () => MODELS,
  streamChat: stream,
};
