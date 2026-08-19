import { ProviderError, isRetryableStatus, type ChatRequest, type StreamEvent } from "./types";

/**
 * Shared streaming client for OpenAI-compatible /chat/completions endpoints.
 * OpenRouter, Groq and Cohere all speak this dialect, so a new
 * provider usually only supplies a base URL, key and model list.
 */
export async function* streamOpenAICompatible(opts: {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  req: ChatRequest;
  /**
   * Upstreams that understand OpenRouter's `reasoning` / `plugins` fields. Only
   * those get an explicit *off* switch; hosts that would reject the unknown
   * field simply receive nothing, and the event filter below still applies.
   */
  supportsExtras?: boolean;
}): AsyncIterable<StreamEvent> {
  const { providerId, baseUrl, apiKey, headers = {}, req, supportsExtras = false } = opts;

  // The toggles are authoritative: with Thinking off no reasoning is requested
  // (and none is relayed), with Web search off the web plugin is disabled and
  // an ":online" model variant is stripped back to its plain model.
  const thinkingOn = Boolean(req.reasoning);
  const webSearchOn = req.webSearch === true;
  const model = webSearchOn ? req.model : req.model.replace(/:online$/, "");

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...headers,
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        // Reasoning is requested only when Thinking is on. When it is off the
        // upstream is asked to switch reasoning off explicitly, so a
        // reasoning-native model does not think anyway.
        ...(thinkingOn
          ? { reasoning: req.reasoning, include_reasoning: true }
          : supportsExtras
            ? { reasoning: { enabled: false, exclude: true }, include_reasoning: false }
            : {}),
        // OpenRouter's web plugin. An empty plugin list with Web search off
        // also overrides any account-level default, and no tools are offered,
        // so the model has no way to search on its own.
        ...(webSearchOn
          ? { plugins: [{ id: "web" }] }
          : supportsExtras
            ? { plugins: [] }
            : {}),
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ProviderError(
      `Could not reach ${providerId}. Check your network connection.`,
      502,
      providerId,
      true,
    );
  }

  if (!res.ok || !res.body) {
    const detail = await safeErrorMessage(res);
    // A rejected key reads as an account error upstream (OpenRouter answers
    // 401 "User not found."), which is misleading in the chat. Name the real
    // problem instead of forwarding that text.
    if (res.status === 401 || res.status === 403) {
      console.error(`[ugnay] ${providerId} rejected the API key: ${detail}`);
      throw new ProviderError(
        `${providerId} rejected the server's API key. Set a valid key for ${providerId} and restart.`,
        res.status,
        providerId,
      );
    }

    const retryable = isRetryableStatus(res.status);
    if (retryable) {
      // Upstream capacity problems ("Service temporarily overloaded", 429, 5xx)
      // are transient and read better as a busy model than as a raw API error.
      console.error(`[ugnay] ${providerId} upstream ${res.status}: ${detail}`);
      throw new ProviderError(
        `The model is busy right now (${detail}).`,
        res.status || 503,
        providerId,
        true,
      );
    }

    throw new ProviderError(detail, res.status || 502, providerId);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        for (const line of frame.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue; // keep-alive / partial comment frames
          }

          if (parsed.error) {
            const status = Number(parsed.error.code) || 502;
            const message: string = parsed.error.message ?? `${providerId} returned an error.`;
            // OpenRouter names the failing upstream in error.metadata; without it
            // "Provider returned error" is impossible to act on.
            const meta = parsed.error.metadata ?? {};
            const upstream: string | undefined = meta.provider_name ?? meta.provider;
            const detail: string | undefined =
              typeof meta.raw === "string" ? meta.raw.slice(0, 300) : undefined;
            console.error(`[ugnay] ${providerId} stream error`, {
              status,
              message,
              upstream,
              detail,
            });

            const overloaded = /overload|capacity|rate.?limit|temporarily|busy/i.test(message);
            const described = [upstream ? `${upstream}: ` : "", detail || message]
              .join("")
              .trim();
            throw new ProviderError(
              overloaded ? `The model is busy right now (${described}).` : described,
              status,
              providerId,
              overloaded || isRetryableStatus(status),
            );
          }

          const delta = parsed.choices?.[0]?.delta;

          // Dropped outright when Thinking is off, so a model that reasons
          // regardless never surfaces a trace.
          const reasoning: string | undefined =
            thinkingOn && typeof delta?.reasoning === "string" ? delta.reasoning : undefined;
          if (reasoning) yield { type: "reasoning", text: reasoning };

          const text: string | undefined = delta?.content;
          if (text) yield { type: "delta", text };

          if (parsed.usage) {
            yield {
              type: "usage",
              usage: {
                promptTokens: parsed.usage.prompt_tokens,
                completionTokens: parsed.usage.completion_tokens,
                totalTokens: parsed.usage.total_tokens,
              },
            };
          }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  yield { type: "done" };
}

async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.text();
    const json = JSON.parse(body);
    return json?.error?.message ?? json?.message ?? body.slice(0, 300);
  } catch {
    return `Upstream provider responded with ${res.status}.`;
  }
}
