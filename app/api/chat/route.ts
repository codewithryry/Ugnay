import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_MODEL,
  ProviderError,
  isModelAvailable,
  listCatalog,
  noteModelOk,
  noteModelUnavailable,
  resolveModel,
  type ProviderMessage,
  type Usage,
} from "@/lib/providers";
import {
  composeCapabilityInstructions,
  composeHistoryContext,
  composeKnowledgeContext,
  composeSystemPrompt,
  composeTitleMessages,
  withSystemPrompt,
} from "@/lib/prompt";
import { embedQuery, embedText, toVectorLiteral } from "@/lib/providers/embeddings";
import { loadModelControls, type ModelControls } from "@/lib/model-controls";
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

/** Upper bound on models tried for one request, so a bad minute cannot stall. */
const MAX_ROUTE_ATTEMPTS = 5;
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
 * Configured models in the order automatic routing should try them: anything
 * that just failed upstream goes last, then the requested pair, then the
 * provider that was asked for, free models before metered ones, and finally
 * the registry order — which is the configured provider priority. Providers
 * that draw on a credit balance are never reached automatically.
 */
function routeCandidates(providerId: string, model: string, controls: ModelControls) {
  const catalog = listCatalog().filter(
    (entry) =>
      entry.configured &&
      !AUTO_EXCLUDED_PROVIDERS.has(entry.id) &&
      controls.statusOf(entry.id, "") === "available",
  );
  const candidates = [
    ...catalog.filter((entry) => entry.id === providerId),
    ...catalog.filter((entry) => entry.id !== providerId),
  ].flatMap((entry, providerRank) =>
    entry.models
      // Disabled or under maintenance is never routed to automatically.
      .filter((m) => controls.statusOf(entry.id, m.id) === "available")
      .map((m, modelRank) => ({
        providerId: entry.id,
        model: m.id,
        free: m.free,
        available: isModelAvailable(entry.id, m.id),
        requested: entry.id === providerId && m.id === model,
        priority: controls.priorityOf(entry.id, m.id),
        rank: providerRank * 100 + modelRank,
      })),
  );

  return candidates
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        b.priority - a.priority ||
        Number(b.requested) - Number(a.requested) ||
        Number(b.free) - Number(a.free) ||
        a.rank - b.rank,
    )
    .slice(0, MAX_ROUTE_ATTEMPTS)
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
/** How many passages from the knowledge base are recalled per turn. */
const KNOWLEDGE_MATCH_LIMIT = 5;
/**
 * Cosine similarity a passage must clear to be worth sending. Without a floor
 * every question drags in the nearest paragraph of an unrelated document.
 */
const KNOWLEDGE_MIN_SIMILARITY = 0.35;

/**
 * Phrases that ask for the uploaded files even though Knowledge mode is off,
 * e.g. "summarise the document I uploaded". Deliberately narrow: the point of
 * the gate is that a general question is NOT answered from the knowledge base,
 * so only an explicit reference to the user's own files opens it. Matched on
 * the raw message, so nothing is embedded or read unless one of these appears.
 */
const KNOWLEDGE_REFERENCE =
  /(?:knowledge base|(?:my|the|that|this|these|those)\s+(?:uploaded\s+)?(?:file|files|document|documents|doc|docs|pdf|pdfs|upload|uploads|attachment|attachments|notes)|(?:file|files|document|documents|doc|docs|pdf|pdfs|notes)\s+(?:i|we)\s+(?:uploaded|attached|added|shared))/i;

/** True when the message itself asks for the user's uploaded files. */
function mentionsUploads(message: string) {
  return KNOWLEDGE_REFERENCE.test(message);
}

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
    /**
     * Knowledge mode: search this account's uploaded files for the turn. Off by
     * default, so a general question is answered from the normal context only.
     */
    knowledge?: boolean;
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

  // Automatic whenever the request carries no model the user picked: the
  // account default (or the app default) means "answer with whatever works".
  // A model the user chose is honoured exactly.
  const isAuto =
    !body.model ||
    body.model === (settings?.default_model ?? DEFAULT_MODEL) ||
    body.model === DEFAULT_MODEL;

  // Admin overrides: the global switch, then the status of the chosen model.
  const controls = await loadModelControls(supabase);
  if (controls.settings.maintenance) {
    return NextResponse.json(
      { error: controls.settings.message || "Ugnay AI is temporarily unavailable for maintenance." },
      { status: 503 },
    );
  }

  // A model the user picked is never swapped for another one, so a model the
  // admin took offline has to be reported instead of silently rerouted.
  const chosenStatus = controls.statusOf(provider.id, model);
  if (chosenStatus !== "available" && !isAuto) {
    return NextResponse.json(
      {
        error:
          chosenStatus === "maintenance"
            ? "That model is under maintenance. Please choose another one."
            : "That model has been disabled. Please choose another one.",
      },
      { status: 503 },
    );
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

  // Knowledge recall: passages from the files this account uploaded. Separate
  // from conversation memory on purpose — a file was uploaded to be used, so it
  // is searched whether or not personalisation is on, and it is skipped only
  // when there is nothing indexed. A temporary chat still gets it: the files
  // are the user's own, and nothing about the turn is written down.
  let knowledgeContext: string | null = null;
  /** File names the answer was grounded in, relayed to the client for citation. */
  let knowledgeSources: string[] = [];
  if (body.knowledge === true || mentionsUploads(content)) {
    // A cheap count first: without it an account with no knowledge base would
    // still pay for one embedding call whenever the gate above opens.
    const { count: indexedFiles } = await supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .not("indexed_at", "is", null);

    const startedAt = Date.now();
    // The model is needed as well as the vector: passages embedded by a
    // different model are not comparable to this one, so the search is scoped
    // to the model that answered here.
    const { vector: queryVector, model: queryModel } = indexedFiles
      ? await embedQuery(content)
      : { vector: null, model: null };
    const embeddedAt = Date.now();

    if (queryVector) {
      const { data: passages, error: knowledgeError } = await supabase.rpc("match_user_files", {
        query_embedding: toVectorLiteral(queryVector),
        match_count: KNOWLEDGE_MATCH_LIMIT,
        model_filter: queryModel,
      });

      if (knowledgeError) {
        // Most likely the v0.8 migration has not been run. The turn continues
        // without the knowledge base rather than failing.
        console.error("[ugnay] Knowledge recall unavailable:", knowledgeError);
      } else {
        const rows = (passages ?? []) as {
          file_name: string;
          content: string;
          similarity: number;
        }[];
        const kept = rows.filter((p) => p.similarity >= KNOWLEDGE_MIN_SIMILARITY);

        // Retrieval log: the scores and the two latencies are what a "why did
        // it not find my document" question actually needs. Content is never
        // logged — only names and numbers.
        console.log(
          `[ugnay] knowledge recall: ${kept.length}/${rows.length} passages over ` +
            `${KNOWLEDGE_MIN_SIMILARITY} · model ${queryModel} · ` +
            `embed ${embeddedAt - startedAt}ms · search ${Date.now() - embeddedAt}ms · ` +
            `scores ${rows.map((p) => `${p.file_name}=${p.similarity.toFixed(3)}`).join(", ") || "none"}`,
        );

        if (kept.length) {
          knowledgeSources = [...new Set(kept.map((p) => p.file_name))];
          knowledgeContext = composeKnowledgeContext(
            kept.map((p) => ({ file_name: p.file_name, content: p.content })),
          );
        }
      }
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
    [settings?.global_system_prompt, historyContext, knowledgeContext]
      .filter(Boolean)
      .join("\n\n"),
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
      const routed = isAuto ? routeCandidates(provider.id, model, controls) : [];
      const primary = routed[0] ?? { provider, model };
      const attempts = [
        { ...primary, extras: true },
        // Retry the SAME model without the optional extras: some upstreams
        // reject `reasoning`/web plugins and answer "Provider returned error".
        ...(wantsExtras ? [{ ...primary, extras: false }] : []),
        ...routed.slice(1).map((target) => ({ ...target, extras: false })),
      ];
      // Auto with nothing left to route to: every model is disabled, under
      // maintenance, or its provider is off.
      if (isAuto && !routed.length) {
        send({
          type: "error",
          error: "No AI model is available right now. Please try again later.",
        });
        controller.close();
        return;
      }

      try {
        send({
          type: "start",
          userMessageId: savedUserId,
          provider: primary.provider.id,
          model: primary.model,
        });

        // Which uploaded files this answer was grounded in. Sent before the
        // first token so the citation is on screen while the reply streams.
        if (knowledgeSources.length) send({ type: "sources", sources: knowledgeSources });

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
            const startedAt = Date.now();
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
            noteModelOk(attempt.provider.id, attempt.model, Date.now() - startedAt);
            used = attempt;
            truncated = passFinish === "length";
            break;
          } catch (err) {
            // Only a retryable failure with nothing streamed yet may fall back;
            // otherwise the user would see two half answers.
            const retryable =
              err instanceof ProviderError && err.retryable && !text && index < attempts.length - 1;
            if (err instanceof ProviderError && err.retryable) {
              // Real upstream failure: skip this pair for the next little
              // while so other requests route around it too.
              noteModelUnavailable(attempt.provider.id, attempt.model, err.status);
            }
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
