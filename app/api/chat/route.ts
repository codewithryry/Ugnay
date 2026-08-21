import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  ProviderError,
  listCatalog,
  resolveModel,
  type ProviderMessage,
  type Usage,
} from "@/lib/providers";
import {
  composeCapabilityInstructions,
  composeHistoryContext,
  composeSystemPrompt,
  composeTitleMessages,
  withSystemPrompt,
} from "@/lib/prompt";
import { embedText, toVectorLiteral } from "@/lib/providers/embeddings";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_CHAT_TITLE,
  isSmallTalk,
  normalizeTitle,
  titleFromMessage,
} from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Streams can outlive the default budget on slow free models. */
export const maxDuration = 60;

/** Up to this many alternative models are tried when one is unavailable. */
const MAX_FALLBACKS = 2;
/**
 * Providers that automatic selection must never reach: they draw on a metered
 * credit balance, so they are only used when the user picks them explicitly.
 */
const AUTO_EXCLUDED_PROVIDERS = new Set(["puter"]);
/** Puter replies allowed per account per calendar month. */
const PUTER_MONTHLY_LIMIT = Number(process.env.PUTER_MONTHLY_LIMIT) || 50;
/** Budget for the one-off title pass: a handful of words, so this is plenty. */
const TITLE_MAX_TOKENS = 24;

/** Replies allowed per account per minute, across every provider. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

/**
 * Input ceilings. Everything below is checked before a provider is called or a
 * row is written, so an oversized payload costs nothing.
 */
const MAX_CONTENT_CHARS = 24_000;
/** Turns a temporary chat may replay. Generous next to HISTORY_LIMIT. */
const MAX_TEMPORARY_MESSAGES = 200;
const MAX_TEMPORARY_TOTAL_CHARS = 200_000;

/**
 * Summarises a chat's first exchange into a short title, using the same
 * provider that answered. Falls back to the opening message (and, for a chat
 * with no real topic yet, to the placeholder) when the pass is unusable.
 */
async function generateChatTitle(
  target: ReturnType<typeof resolveModel>,
  userMessage: string,
  assistantMessage: string,
  signal: AbortSignal,
) {
  if (isSmallTalk(userMessage) && assistantMessage.trim().length < 40) {
    return DEFAULT_CHAT_TITLE;
  }

  try {
    let raw = "";
    for await (const event of target.provider.streamChat({
      model: target.model,
      messages: composeTitleMessages(userMessage, assistantMessage),
      temperature: 0.2,
      maxTokens: TITLE_MAX_TOKENS,
      signal,
    })) {
      if (event.type === "delta") raw += event.text;
    }
    const title = normalizeTitle(raw);
    if (title && title !== DEFAULT_CHAT_TITLE) return title;
  } catch (err) {
    console.error("[ugnay] Could not generate a chat title:", err);
  }

  return titleFromMessage(userMessage);
}

/**
 * Other configured models, nearest first: same provider before a different one,
 * free models before paid. Used only when the chosen model is unavailable.
 */
function fallbackTargets(providerId: string, model: string) {
  const catalog = listCatalog().filter(
    (entry) => entry.configured && !AUTO_EXCLUDED_PROVIDERS.has(entry.id),
  );
  const candidates = [
    ...catalog.filter((entry) => entry.id === providerId),
    ...catalog.filter((entry) => entry.id !== providerId),
  ].flatMap((entry) =>
    entry.models
      .filter((m) => !(entry.id === providerId && m.id === model))
      .map((m) => ({ providerId: entry.id, model: m.id, free: m.free })),
  );

  return candidates
    .sort((a, b) => Number(b.free) - Number(a.free))
    .slice(0, MAX_FALLBACKS)
    .map((candidate) => {
      const { provider, model: resolved } = resolveModel(candidate.providerId, candidate.model);
      return { provider, model: resolved };
    });
}

/** Newest N messages sent as context. Older turns are kept in the DB. */
const HISTORY_LIMIT = 40;
/** How many earlier conversations feed the optional cross-chat context. */
const MEMORY_CHAT_LIMIT = 8;
/** How many semantically similar past messages to recall. */
const MEMORY_MATCH_LIMIT = 5;

/**
 * Server-side provider router + streaming endpoint.
 *
 * Responsibilities kept here (never in the browser):
 *  - authenticating the caller and verifying chat ownership
 *  - reading the user's settings and composing the system prompt
 *  - persisting the user + assistant messages
 *  - holding the provider API keys
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // A stale or revoked session (e.g. the user row no longer exists) surfaces
  // here as an auth error, not as a server fault — answer 401 so the client can
  // ask the visitor to sign in again instead of showing a generic 500.
  if (userError) console.error("[ugnay] /api/chat could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  // Keyed by account, so one caller cannot spend another's budget.
  const limit = rateLimit(`chat:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: {
    chatId?: string;
    content?: string;
    provider?: string;
    model?: string;
    /** Temporary chat: stream a reply without persisting anything. */
    temporary?: boolean;
    /** Prior turns of a temporary conversation, which has no rows to read. */
    messages?: { role: "user" | "assistant"; content: string }[];
    /** Reasoning effort for this turn, when the user enabled Thinking. */
    thinking?: "low" | "medium" | "high" | null;
    /** Let the provider search the web for this turn. */
    webSearch?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let chatId = body.chatId?.trim();
  const content = body.content?.trim();
  const temporary = body.temporary === true;
  if (!temporary && !chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }
  if (!content) return NextResponse.json({ error: "Message content is required." }, { status: 400 });
  if (content.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      { error: `Your message is too long. Keep it under ${MAX_CONTENT_CHARS} characters.` },
      { status: 400 },
    );
  }

  // A temporary chat replays its own history, so that array is caller-supplied
  // and has to be bounded as well.
  if (temporary && body.messages) {
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages must be an array." }, { status: 400 });
    }
    if (body.messages.length > MAX_TEMPORARY_MESSAGES) {
      return NextResponse.json({ error: "This conversation is too long." }, { status: 400 });
    }
    let total = 0;
    for (const message of body.messages) {
      const length = typeof message?.content === "string" ? message.content.length : 0;
      if (length > MAX_CONTENT_CHARS) {
        return NextResponse.json(
          { error: "One of the earlier messages is too long." },
          { status: 400 },
        );
      }
      total += length;
    }
    if (total > MAX_TEMPORARY_TOTAL_CHARS) {
      return NextResponse.json({ error: "This conversation is too long." }, { status: 400 });
    }
  }

  // A temporary conversation never appears in History, but its turns are still
  // recorded: they land in one hidden chat row per account (chats.is_temporary)
  // that no listing reads. The first turn creates it; later turns reuse it.
  if (temporary) {
    const { data: existing } = await supabase
      .from("chats")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_temporary", true)
      .maybeSingle();

    if (existing) {
      chatId = existing.id;
    } else {
      const { data: created, error: createError } = await supabase
        .from("chats")
        .insert({ user_id: user.id, title: "Temporary chat", is_temporary: true })
        .select("id")
        .single();

      if (created) {
        chatId = created.id;
      } else {
        // Two first turns racing each other: the partial unique index lets
        // exactly one insert win, so read the winner back instead of failing.
        const { data: winner } = await supabase
          .from("chats")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_temporary", true)
          .maybeSingle();
        if (!winner) {
          console.error("[ugnay] /api/chat could not prepare the temporary chat:", createError);
          return NextResponse.json({ error: "Could not save your message." }, { status: 500 });
        }
        chatId = winner.id;
      }
    }
  }

  // RLS already scopes this, but the explicit filter keeps the intent obvious.
  // A temporary chat has no visible row, so there is nothing to load or own.
  let chat: {
    id: string;
    title: string | null;
    provider: string | null;
    model: string | null;
    system_prompt: string | null;
    project_id: string | null;
  } | null = null;
  /** Instructions from the workspace this chat belongs to, if any. */
  let projectInstructions: string | null = null;
  /** A workspace may switch conversation memory off for its own chats. */
  let projectMemoryEnabled = true;

  if (!temporary) {
    const { data, error: chatError } = await supabase
      .from("chats")
      .select("id, title, provider, model, system_prompt, project_id")
      .eq("id", chatId!)
      .eq("user_id", user.id)
      .single();

    if (chatError || !data) {
      console.error("[ugnay] /api/chat could not load the chat:", chatError);
      return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    }
    chat = data;

    // A workspace's instructions apply to every conversation inside it.
    if (chat.project_id) {
      const { data: project, error: projectError } = await supabase
        .from("projects")
        .select("instructions, memory_enabled")
        .eq("id", chat.project_id)
        .maybeSingle();
      if (projectError) {
        console.error("[ugnay] /api/chat could not load the workspace:", projectError);
      } else {
        projectInstructions = project?.instructions?.trim() || null;
        projectMemoryEnabled = project?.memory_enabled ?? true;
      }
    }
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      "global_system_prompt, temperature, max_tokens, default_provider, default_model, personalize_with_history",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // resolveModel throws on an unknown provider/model, which would otherwise
  // escape as an opaque 500.
  let provider: ReturnType<typeof resolveModel>["provider"];
  let model: string;
  try {
    ({ provider, model } = resolveModel(
      body.provider ?? chat?.provider ?? settings?.default_provider ?? "openrouter",
      body.model ?? chat?.model ?? settings?.default_model ?? "openrouter/free",
    ));
  } catch (err) {
    console.error("[ugnay] /api/chat could not resolve the model:", err);
    const message =
      err instanceof ProviderError ? err.message : "That model is not available.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Metered providers are capped per account. Counted from stored replies, so
  // no extra table is needed; temporary replies are stored too, so they count
  // toward the cap as well — they draw on the same credit balance.
  if (!temporary && AUTO_EXCLUDED_PROVIDERS.has(provider.id)) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const { count, error: countError } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("role", "assistant")
      .eq("provider", provider.id)
      .gte("created_at", monthStart.toISOString());

    if (countError) {
      console.error("[ugnay] Could not check the provider quota:", countError);
    } else if ((count ?? 0) >= PUTER_MONTHLY_LIMIT) {
      return NextResponse.json(
        {
          error: `You have used this month's ${PUTER_MONTHLY_LIMIT} DeepSeek replies. Pick another model or try again next month.`,
        },
        { status: 429 },
      );
    }
  }

  // A temporary conversation lives only in the caller's browser, so its prior
  // turns arrive with the request instead of being read back from the database.
  const history = temporary
    ? (body.messages ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-HISTORY_LIMIT)
        .map((m) => ({ role: m.role, content: String(m.content ?? "") }))
    : (
        await supabase
          .from("messages")
          .select("role, content")
          .eq("chat_id", chatId!)
          .order("created_at", { ascending: true })
          .limit(HISTORY_LIMIT)
      ).data;

  // Persist the user turn before calling out, so nothing is lost if the
  // provider fails midway. Temporary chats skip every write.
  let savedUserId: string | null = null;
  if (!temporary) {
    const { data: savedUser, error: insertError } = await supabase
      .from("messages")
      .insert({ chat_id: chatId!, user_id: user.id, role: "user", content })
      .select("id, created_at")
      .single();

    if (insertError || !savedUser) {
      console.error("[ugnay] /api/chat could not save the user message:", insertError);
      return NextResponse.json({ error: "Could not save your message." }, { status: 500 });
    }
    savedUserId = savedUser.id;
  }

  // Optional cross-chat memory. Scoped to this user's own rows (and RLS), and
  // skipped entirely unless they enabled it in Settings → Data Controls.
  let historyContext: string | null = null;
  // Both switches must be on: the account setting and, inside a workspace,
  // that workspace's own.
  const memoryEnabled = Boolean(settings?.personalize_with_history) && projectMemoryEnabled;
  if (!temporary && memoryEnabled) {
    // Semantic recall over this user's own earlier messages. RLS plus the
    // function's auth.uid() filter keep it to their rows.
    const queryVector = await embedText(content, "search_query");
    if (queryVector) {
      const { data: matches, error: matchError } = await supabase.rpc("match_user_messages", {
        query_embedding: toVectorLiteral(queryVector),
        match_count: MEMORY_MATCH_LIMIT,
        exclude_chat: chatId ?? null,
      });

      if (matchError) {
        // Most likely the migration has not been run; fall through to the
        // title digest below rather than failing the turn.
        console.error("[ugnay] Vector recall unavailable:", matchError);
      } else if (matches?.length) {
        historyContext = composeHistoryContext(
          (matches as { chat_title: string; content: string; similarity: number }[]).map((m) => ({
            title: m.chat_title,
            updated_at: "",
            excerpt: m.content.replace(/\s+/g, " ").slice(0, 240),
          })),
        );
      }
    }
  }

  // Fallback recall: the most recent conversations, by title and opening line.
  if (!temporary && !historyContext && memoryEnabled) {
    const { data: recentChats, error: recentError } = await supabase
      .from("chats")
      .select("id, title, updated_at")
      .eq("user_id", user.id)
      .neq("id", chatId!)
      .order("updated_at", { ascending: false })
      .limit(MEMORY_CHAT_LIMIT);

    if (recentError) {
      console.error("[ugnay] /api/chat could not read earlier conversations:", recentError);
    } else if (recentChats?.length) {
      const { data: recentMessages } = await supabase
        .from("messages")
        .select("chat_id, content, created_at")
        .eq("user_id", user.id)
        .in(
          "chat_id",
          recentChats.map((c) => c.id),
        )
        .eq("role", "user")
        .order("created_at", { ascending: false });

      const firstByChat = new Map<string, string>();
      for (const m of recentMessages ?? []) {
        if (!firstByChat.has(m.chat_id)) firstByChat.set(m.chat_id, m.content);
      }

      historyContext = composeHistoryContext(
        recentChats
          .filter((c) => firstByChat.has(c.id))
          .map((c) => ({
            title: c.title,
            updated_at: c.updated_at,
            excerpt: (firstByChat.get(c.id) ?? "").replace(/\s+/g, " ").slice(0, 240),
          })),
      );
    }
  }

  // The two Composer toggles, read strictly from this request: whatever the
  // client sent for this turn decides the turn, so flipping a toggle mid-chat
  // takes effect on the very next message.
  const thinking =
    body.thinking === "low" || body.thinking === "medium" || body.thinking === "high"
      ? body.thinking
      : null;
  const webSearch = body.webSearch === true;

  const systemPrompt = composeSystemPrompt(
    [settings?.global_system_prompt, historyContext].filter(Boolean).join("\n\n"),
    [projectInstructions, chat?.system_prompt].filter(Boolean).join("\n\n") || null,
    composeCapabilityInstructions({ thinking: thinking !== null, webSearch }),
  );
  const conversation: ProviderMessage[] = withSystemPrompt(
    [...((history ?? []) as ProviderMessage[]), { role: "user", content }],
    systemPrompt,
  );

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      let text = "";
      let usage: Usage = {};

      // The chosen model first, then other configured ones as fallbacks for a
      // busy or failing upstream (e.g. "Service temporarily overloaded").
      // Switching model is only ever done for Auto, which is a request to pick
      // a working model; an explicitly chosen model is never swapped silently —
      // the user is asked to choose another one instead.
      const wantsExtras = thinking !== null || webSearch;
      const isAuto = provider.id === DEFAULT_PROVIDER && model === DEFAULT_MODEL;
      const attempts = [
        { provider, model, extras: true },
        // Retry the SAME model without the optional extras: some upstreams
        // reject `reasoning`/web plugins and answer "Provider returned error".
        ...(wantsExtras ? [{ provider, model, extras: false }] : []),
        ...(isAuto
          ? fallbackTargets(provider.id, model).map((target) => ({ ...target, extras: false }))
          : []),
      ];

      try {
        send({ type: "start", userMessageId: savedUserId, provider: provider.id, model });

        let lastError: ProviderError | null = null;
        /** The attempt that produced the streamed text; continuations reuse it. */
        let used: (typeof attempts)[number] | null = null;
        /** True when the last pass stopped because it hit the token cap. */
        let truncated = false;

        for (let index = 0; index < attempts.length; index += 1) {
          const attempt = attempts[index];
          try {
            if (index > 0) {
              const sameModel =
                attempt.provider.id === attempts[index - 1].provider.id &&
                attempt.model === attempts[index - 1].model;
              send({
                type: "notice",
                notice: `${lastError?.message ?? "That model failed."} ${
                  sameModel
                    ? "Retrying without thinking/web search."
                    : `Retrying with ${attempt.model}.`
                }`,
              });
              send({ type: "start", userMessageId: savedUserId, provider: attempt.provider.id, model: attempt.model });
            }

            let passFinish: "stop" | "length" | undefined;
            for await (const event of attempt.provider.streamChat({
              model: attempt.model,
              messages: conversation,
              temperature: settings?.temperature ?? 0.7,
              maxTokens: settings?.max_tokens ?? 2048,
              signal: abort.signal,
              reasoning: attempt.extras && thinking ? { effort: thinking } : undefined,
              webSearch: attempt.extras && webSearch,
            })) {
              if (event.type === "reasoning") {
                // Reasoning is relayed live only, never persisted — and only
                // when the user turned Thinking on. A provider that reasons
                // regardless is filtered out here as a last line of defence.
                if (thinking) send({ type: "reasoning", text: event.text });
              } else if (event.type === "delta") {
                text += event.text;
                send({ type: "delta", text: event.text });
              } else if (event.type === "usage") {
                usage = event.usage;
              } else if (event.type === "done") {
                passFinish = event.finishReason;
              }
            }
            used = attempt;
            truncated = passFinish === "length";
            break;
          } catch (err) {
            // Only a retryable failure with nothing streamed yet may fall back;
            // otherwise the user would see two half answers.
            const retryable =
              err instanceof ProviderError && err.retryable && !text && index < attempts.length - 1;
            if (!retryable) throw err;
            lastError = err as ProviderError;
            console.error(
              `[ugnay] ${attempt.provider.id}/${attempt.model} failed (${lastError.status}); trying the next model.`,
            );
          }
        }

        /**
         * A reply cut off by the token cap continues automatically, in the
         * same stream and under the same message row, so a long answer always
         * reaches its natural end and the user never has to type "continue".
         * Bounded rounds keep a looping model from spinning forever.
         */
        const MAX_CONTINUATIONS = 3;
        for (let round = 0; truncated && used && round < MAX_CONTINUATIONS; round += 1) {
          try {
            let passFinish: "stop" | "length" | undefined;
            for await (const event of used.provider.streamChat({
              model: used.model,
              messages: [
                ...conversation,
                { role: "assistant", content: text },
                {
                  role: "user",
                  content:
                    "Your reply above was cut off mid-sentence by a length limit. Continue it seamlessly from exactly where it stopped. Do not repeat any earlier text, do not apologise, and do not add an introduction — output only the continuation.",
                },
              ],
              temperature: settings?.temperature ?? 0.7,
              maxTokens: settings?.max_tokens ?? 2048,
              signal: abort.signal,
              reasoning: used.extras && thinking ? { effort: thinking } : undefined,
              webSearch: used.extras && webSearch,
            })) {
              if (event.type === "reasoning") {
                if (thinking) send({ type: "reasoning", text: event.text });
              } else if (event.type === "delta") {
                text += event.text;
                send({ type: "delta", text: event.text });
              } else if (event.type === "done") {
                passFinish = event.finishReason;
              }
            }
            truncated = passFinish === "length";
          } catch (err) {
            // Whatever streamed before the failure is already a usable reply.
            console.error("[ugnay] Continuation pass failed:", err);
            break;
          }
        }

        // An empty completion would otherwise be stored and rendered as a
        // blank reply.
        if (!text.trim()) {
          send({
            type: "error",
            error: "The model returned an empty response. Try again or pick another model.",
            ...(isAuto ? {} : { action: "change-model" }),
          });
          return;
        }

        if (temporary) {
          send({ type: "done", assistantMessageId: null, usage });
          return;
        }

        const { data: saved } = await supabase
          .from("messages")
          .insert({
            chat_id: chatId!,
            user_id: user.id,
            role: "assistant",
            content: text,
            provider: provider.id,
            model,
            prompt_tokens: usage.promptTokens ?? null,
            completion_tokens: usage.completionTokens ?? null,
            total_tokens: usage.totalTokens ?? null,
          })
          .select("id")
          .single();

        // Index the user's turn for future recall. Best-effort: a failure here
        // must not affect the reply that was just delivered.
        if (memoryEnabled && savedUserId) {
          const vector = await embedText(content, "search_document");
          if (vector) {
            const { error: embedError } = await supabase.from("message_embeddings").upsert(
              {
                message_id: savedUserId,
                user_id: user.id,
                chat_id: chatId!,
                content,
                embedding: toVectorLiteral(vector),
              },
              { onConflict: "message_id" },
            );
            if (embedError) console.error("[ugnay] Could not store the embedding:", embedError);
          }
        }

        // Named from the first real exchange, not from the opening line alone,
        // and only while the chat still carries the placeholder title. The
        // hidden temporary chat keeps its placeholder — it has no History entry
        // to name.
        if (!temporary && (!chat!.title || chat!.title === DEFAULT_CHAT_TITLE)) {
          const title = await generateChatTitle(
            { provider, model },
            content,
            text,
            abort.signal,
          );
          if (title !== DEFAULT_CHAT_TITLE) {
            await supabase.from("chats").update({ title }).eq("id", chatId!);
          }
        }

        send({ type: "done", assistantMessageId: saved?.id ?? null, usage });
      } catch (err) {
        const message =
          err instanceof ProviderError
            ? err.message
            : "Something went wrong while generating a response.";
        // Nothing streamed from a model the user picked themselves: the turn
        // stops here, so the client offers the model selector rather than
        // quietly answering with a different model.
        const changeModel = !isAuto && !text;

        // Keep whatever streamed successfully before the failure.
        if (text && !temporary) {
          await supabase.from("messages").insert({
            chat_id: chatId!,
            user_id: user.id,
            role: "assistant",
            content: text,
            provider: provider.id,
            model,
          });
        }
        send({
          type: "error",
          error: changeModel
            ? `${message} This model could not respond — pick another one and try again.`
            : message,
          ...(changeModel ? { action: "change-model" } : {}),
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
