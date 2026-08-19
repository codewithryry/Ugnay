import { ProviderError, isRetryableStatus, type ChatProvider, type ChatRequest, type ModelInfo, type StreamEvent } from "./types";

/**
 * Puter's driver API. Unlike puter.js in the browser (which signs each visitor
 * in and bills them), this calls the HTTP API with a token held on the server,
 * so the app's own Puter account pays and users see no sign-in.
 *
 * Inactive until PUTER_API_TOKEN is set. Get one by signing in at puter.com and
 * reading `localStorage.getItem("puter.auth.token")` in the browser console.
 *
 * Requests draw on that account's credit balance, so the cost knobs below are
 * deliberately conservative. Both are tunable per deployment:
 *   PUTER_MAX_TOKENS   cap on a single reply (default 1024)
 *   PUTER_HISTORY_TURNS how many recent turns are sent as context (default 12)
 */
const BASE_URL = "https://api.puter.com";

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_HISTORY_TURNS = 12;

function budget() {
  const maxTokens = Number(process.env.PUTER_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const historyTurns = Number(process.env.PUTER_HISTORY_TURNS) || DEFAULT_HISTORY_TURNS;
  return { maxTokens, historyTurns };
}

const MODELS: ModelInfo[] = [
  {
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "Balanced reasoning, efficient output.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    description: "Long thinking for complex problems.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro 0813",
    description: "Dated build, stronger at coding.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "deepseek/deepseek-v3.2",
    label: "DeepSeek V3.2",
    description: "Previous generation, still capable.",
    free: false,
    capabilities: ["text"],
  },
  {
    id: "deepseek/deepseek-r1-0528",
    label: "DeepSeek R1",
    description: "Reasoning-focused model.",
    free: false,
    capabilities: ["text"],
  },
];

/** Keeps any system prompt plus the newest `turns` messages. */
function trimHistory(messages: ChatRequest["messages"], turns: number) {
  if (messages.length <= turns) return messages;
  const system = messages[0]?.role === "system" ? [messages[0]] : [];
  return [...system, ...messages.slice(-turns)];
}

/** Pulls text/reasoning out of a driver chunk, whichever shape it arrives in. */
function readChunk(parsed: any, thinkingOn: boolean): StreamEvent[] {
  const events: StreamEvent[] = [];
  // Puter's driver has no reasoning switch, so with Thinking off the trace is
  // dropped here instead of being relayed.
  const reasoning = thinkingOn
    ? parsed?.reasoning ?? parsed?.choices?.[0]?.delta?.reasoning
    : undefined;
  if (typeof reasoning === "string" && reasoning) events.push({ type: "reasoning", text: reasoning });

  const usage = parsed?.usage ?? parsed?.result?.usage;
  if (usage) {
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
    const completionTokens = usage.completion_tokens ?? usage.output_tokens;
    const totalTokens =
      usage.total_tokens ?? (Number(promptTokens) || 0) + (Number(completionTokens) || 0);
    console.info("[ugnay] puter usage", { promptTokens, completionTokens, totalTokens });
    events.push({ type: "usage", usage: { promptTokens, completionTokens, totalTokens } });
  }

  const text =
    parsed?.text ??
    parsed?.choices?.[0]?.delta?.content ??
    parsed?.message?.content ??
    parsed?.result?.message?.content;
  if (typeof text === "string" && text) events.push({ type: "delta", text });

  return events;
}

async function* streamPuter(req: ChatRequest): AsyncIterable<StreamEvent> {
  const limits = budget();
  const thinkingOn = Boolean(req.reasoning);
  const token = process.env.PUTER_API_TOKEN;
  if (!token) {
    throw new ProviderError("PUTER_API_TOKEN is not set on the server.", 500, "puter");
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/drivers/call`, {
      method: "POST",
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        interface: "puter-chat-completion",
        method: "complete",
        args: {
          model: req.model,
          // Input tokens cost credits too, so only the recent turns travel —
          // the system prompt (first message) is always kept.
          messages: trimHistory(req.messages, limits.historyTurns),
          stream: true,
          max_tokens: Math.min(req.maxTokens, limits.maxTokens),
          temperature: req.temperature,
        },
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    throw new ProviderError("Could not reach Puter. Check your connection.", 502, "puter", true);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error(`[ugnay] puter ${res.status}: ${detail.slice(0, 300)}`);
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        "Puter rejected the server's token. Set a valid PUTER_API_TOKEN and restart.",
        res.status,
        "puter",
      );
    }
    throw new ProviderError(
      detail.slice(0, 200) || "Puter returned an error.",
      res.status || 502,
      "puter",
      isRetryableStatus(res.status),
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // The driver streams newline-delimited JSON; SSE framing is tolerated too.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
        if (!payload || payload === "[DONE]") continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed?.error) {
          const message: string = parsed.error.message ?? parsed.error ?? "Puter returned an error.";
          throw new ProviderError(String(message), 502, "puter", true);
        }

        for (const event of readChunk(parsed, thinkingOn)) yield event;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  yield { type: "done" };
}

export const puterProvider: ChatProvider = {
  id: "puter",
  label: "Puter (DeepSeek)",
  isConfigured: () => Boolean(process.env.PUTER_API_TOKEN),
  listModels: () => MODELS,
  streamChat: (req) => streamPuter(req),
};
