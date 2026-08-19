import { NextResponse, type NextRequest } from "next/server";
import {
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
  withSystemPrompt,
} from "@/lib/prompt";
import { embedText, toVectorLiteral } from "@/lib/providers/embeddings";
import { createClient } from "@/lib/supabase/server";
import { titleFromMessage } from "@/lib/utils";

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
  const supabase = createClient();
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

  const chatId = body.chatId?.trim();
  const content = body.content?.trim();
  const temporary = body.temporary === true;
  if (!temporary && !chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }
  if (!content) return NextResponse.json({ error: "Message content is required." }, { status: 400 });

  // RLS already scopes this, but the explicit filter keeps the intent obvious.
  // A temporary chat has no row, so there is nothing to load or own.
  let chat: {
    id: string;
    title: string | null;
    provider: string | null;
    model: string | null;
    system_prompt: string | null;
  } | null = null;

  if (!temporary) {
    const { data, error: chatError } = await supabase
      .from("chats")
      .select("id, title, provider, model, system_prompt")
      .eq("id", chatId!)
      .eq("user_id", user.id)
      .single();

    if (chatError || !data) {
      console.error("[ugnay] /api/chat could not load the chat:", chatError);
      return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    }
    chat = data;
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
  // no extra table is needed; temporary chats are not counted or capped.
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

    if (!chat!.title || chat!.title === "New chat") {
      await supabase.from("chats").update({ title: titleFromMessage(content) }).eq("id", chatId!);
    }
  }

  // Optional cross-chat memory. Scoped to this user's own rows (and RLS), and
  // skipped entirely unless they enabled it in Settings → Data Controls.
  let historyContext: string | null = null;
  if (!temporary && settings?.personalize_with_history) {
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
  if (!temporary && !historyContext && settings?.personalize_with_history) {
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
    chat?.system_prompt,
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
      const wantsExtras = thinking !== null || webSearch;
      const attempts = [
        { provider, model, extras: true },
        // Retry the SAME model without the optional extras: some upstreams
        // reject `reasoning`/web plugins and answer "Provider returned error".
        ...(wantsExtras ? [{ provider, model, extras: false }] : []),
        ...fallbackTargets(provider.id, model).map((target) => ({ ...target, extras: false })),
      ];

      try {
        send({ type: "start", userMessageId: savedUserId, provider: provider.id, model });

        let lastError: ProviderError | null = null;

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
              }
            }
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

        // An empty completion would otherwise be stored and rendered as a
        // blank reply.
        if (!text.trim()) {
          send({
            type: "error",
            error: "The model returned an empty response. Try again or pick another model.",
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
        if (settings?.personalize_with_history && savedUserId) {
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

        send({ type: "done", assistantMessageId: saved?.id ?? null, usage });
      } catch (err) {
        const message =
          err instanceof ProviderError
            ? err.message
            : "Something went wrong while generating a response.";

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
        send({ type: "error", error: message });
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
