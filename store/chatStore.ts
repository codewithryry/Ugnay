"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_CHAT_TITLE, titleFromMessage } from "@/lib/utils";
import { BUILTIN_PRESETS } from "@/lib/presets";
import { isUnrecoverableAuthError } from "@/lib/supabase/auth-errors";
import type { Chat, Message, Preset, Project, UserSettings } from "@/types/db";

export interface ModelInfoLite {
  id: string;
  label: string;
  description?: string;
  free: boolean;
}

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  configured: boolean;
  models: ModelInfoLite[];
}

/** Bucket id for the in-memory conversation used by temporary chat. */
export const TEMPORARY_CHAT_ID = "temporary";

export const DEFAULT_PROVIDER = "openrouter";
export const DEFAULT_MODEL = "openrouter/free";

interface ChatState {
  userId: string | null;
  chats: Chat[];
  projects: Project[];
  /** Workspace new conversations are created in; null means History. */
  activeProjectId: string | null;
  /** Workspace whose panel is open beside the conversation; null when closed. */
  panelProjectId: string | null;
  messagesByChat: Record<string, Message[]>;
  activeChatId: string | null;
  settings: UserSettings | null;
  catalog: ProviderCatalogEntry[];

  /** Provider/model used for the next message; mirrors the active chat. */
  provider: string;
  model: string;

  /** Temporary chat: nothing is written to Supabase while this is on. */
  temporaryChat: boolean;

  /** Reasoning effort requested for the next reply; null disables it. */
  thinking: "low" | "medium" | "high" | null;
  /** Render the reasoning trace as it streams. */
  showThinking: boolean;
  /** Let the provider search the web for the next reply. */
  webSearch: boolean;
  /**
   * Knowledge mode: answer the next reply from the files this account uploaded.
   * Off by default, so an ordinary question is answered from the normal context
   * and never from an unrelated document.
   */
  useKnowledge: boolean;
  /** Live reasoning text per chat. Streamed only — never persisted. */
  reasoningByChat: Record<string, string>;
  /**
   * Knowledge files the current answer was grounded in, per chat. Streamed
   * only, like the reasoning above: it describes one turn's retrieval, so it is
   * cleared when the next turn starts and is gone after a reload.
   */
  knowledgeSourcesByChat: Record<string, string[]>;
  /** Thumbs rating per assistant message id. */
  feedbackByMessage: Record<string, "up" | "down">;

  hydrated: boolean;
  loadingMessages: boolean;
  streaming: boolean;
  streamingChatId: string | null;
  error: string | null;
  /** Set when the error needs the model selector rather than a retry. */
  errorAction: "change-model" | null;
  /** Bumped to ask the model selector to open itself. */
  modelPickerRequests: number;
  /** Block opened in the canvas beside the conversation; null when closed. */
  artifact: { language: string; code: string } | null;
  sidebarOpen: boolean;

  init: (userId: string) => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  setActiveChat: (chatId: string | null) => Promise<void>;
  newChat: () => void;
  createProject: (name: string) => Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<void>;
  saveProject: (
    projectId: string,
    patch: {
      name?: string;
      instructions?: string;
      default_provider?: string | null;
      default_model?: string | null;
      memory_enabled?: boolean;
    },
  ) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => Promise<void>;
  newChatInProject: (projectId: string) => void;
  setPanelProject: (projectId: string | null) => void;
  renameChat: (chatId: string, title: string) => Promise<void>;
  deleteChat: (chatId: string) => Promise<void>;
  /** Copies this conversation up to `messageId` into a new one and opens it. */
  branchFromMessage: (messageId: string) => Promise<void>;
  /** Sidebar organisation: pinned rows sort first, archived ones are hidden. */
  setChatPinned: (chatId: string, pinned: boolean) => Promise<void>;
  setChatArchived: (chatId: string, archived: boolean) => Promise<void>;
  setChatSystemPrompt: (chatId: string, prompt: string | null) => Promise<void>;
  setModel: (provider: string, model: string) => Promise<void>;
  /** Re-reads /api/models in the background; nothing else in the UI moves. */
  refreshCatalog: () => Promise<void>;
  saveSettings: (patch: Partial<UserSettings>) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  setSidebarOpen: (open: boolean) => void;
  setTemporaryChat: (on: boolean) => void;
  setThinking: (effort: "low" | "medium" | "high" | null) => void;
  rateMessage: (messageId: string, rating: "up" | "down" | null) => Promise<void>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  resendMessage: (messageId: string, content: string) => Promise<void>;
  setShowThinking: (on: boolean) => void;
  setWebSearch: (on: boolean) => void;
  setUseKnowledge: (on: boolean) => void;
  setError: (error: string | null) => void;
  openModelPicker: () => void;
  openArtifact: (language: string, code: string) => void;
  closeArtifact: () => void;
}

let abortController: AbortController | null = null;
/**
 * True from the moment a send is accepted until it fully settles. The visible
 * `streaming` flag only turns on after the optimistic append — and, for a new
 * chat, after the awaited row insert — so a repeated click on send, regenerate
 * or any other action could slip a second turn through that gap. This latch is
 * set synchronously, before the first await.
 */
let sendInFlight = false;

/**
 * Drops a session the server has already rejected and sends the user to the
 * sign-in page, rather than leaving the app retrying with a dead token.
 */
async function recoverFromAuthFailure() {
  try {
    await createClient().auth.signOut();
  } catch {
    // The session is already unusable; the redirect below is what matters.
  }
  window.location.assign("/login");
}

/**
 * Supabase errors were previously swallowed behind a generic message, which
 * hid setup problems such as an unmigrated database. Log the real error and,
 * outside production, show it so the cause is visible.
 */
function reportSupabaseError(action: string, error: { message?: string; code?: string } | null) {
  const detail = [error?.code, error?.message].filter(Boolean).join(": ");
  if (detail) console.error(`[ugnay] Could not ${action}:`, error);
  const generic = `Could not ${action}. Please try again.`;
  return process.env.NODE_ENV === "production" || !detail ? generic : `${generic} (${detail})`;
}

/**
 * Optimistic flip of a chat's organisation flags, rolled back if the write
 * fails. Shared by pin and archive so both behave identically.
 */
async function updateChatFlags(
  chatId: string,
  patch: { pinned?: boolean; archived?: boolean },
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
) {
  const previous = get().chats;
  set({ chats: previous.map((c) => (c.id === chatId ? { ...c, ...patch } : c)) });

  const { error } = await createClient().from("chats").update(patch).eq("id", chatId);
  if (error) {
    set({ chats: previous, error: reportSupabaseError("update this conversation", error) });
  }
}

function sortChats(chats: Chat[]) {
  return [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/**
 * One chat turn: optimistic append, streamed reply, persisted swap. Split out
 * of `sendMessage` so the store action stays a thin gate around it.
 */
async function runSend(
  text: string,
  set: { (partial: Partial<ChatState>): void; (updater: (state: ChatState) => Partial<ChatState>): void },
  get: () => ChatState,
) {
  const supabase = createClient();
  const { userId, provider, model, thinking, webSearch, useKnowledge } = get();
  if (!userId) return;

  set({ error: null, errorAction: null });
  const temporary = get().temporaryChat;
  let chatId = temporary ? TEMPORARY_CHAT_ID : get().activeChatId;

  // First message of a draft: create the real chat row now. Temporary chats
  // never get one.
  if (!chatId) {
    const { data, error } = await supabase
      .from("chats")
      .insert({
        user_id: userId,
        title: "New chat",
        provider,
        model,
        project_id: get().activeProjectId,
      })
      .select("*")
      .single();

    if (error || !data) {
      set({ error: reportSupabaseError("start a new chat", error) });
      if (isUnrecoverableAuthError(error)) void recoverFromAuthFailure();
      return;
    }
    const chat = data as Chat;
    chatId = chat.id;
    set((s) => ({
      chats: sortChats([chat, ...s.chats]),
      activeChatId: chat.id,
      messagesByChat: { ...s.messagesByChat, [chat.id]: [] },
    }));
  }

  const id = chatId;
  const now = new Date().toISOString();
  const optimisticUser: Message = {
    id: `local-user-${now}`,
    chat_id: id,
    user_id: userId,
    role: "user",
    content: text,
    provider: null,
    model: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    created_at: now,
  };
  const streamingId = `local-assistant-${now}`;
  const optimisticAssistant: Message = {
    ...optimisticUser,
    id: streamingId,
    role: "assistant",
    content: "",
    provider,
    model,
    created_at: new Date(Date.now() + 1).toISOString(),
  };

  set((s) => ({
    streaming: true,
    streamingChatId: id,
    reasoningByChat: { ...s.reasoningByChat, [id]: "" },
    knowledgeSourcesByChat: { ...s.knowledgeSourcesByChat, [id]: [] },
    messagesByChat: {
      ...s.messagesByChat,
      [id]: [...(s.messagesByChat[id] ?? []), optimisticUser, optimisticAssistant],
    },
  }));

  // Reasoning is live-only: cleared when the turn starts, dropped on reload.
  const appendReasoning = (delta: string) =>
    set((s) => ({
      reasoningByChat: { ...s.reasoningByChat, [id]: (s.reasoningByChat[id] ?? "") + delta },
    }));

  const appendDelta = (delta: string) =>
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [id]: (s.messagesByChat[id] ?? []).map((m) =>
          m.id === streamingId ? { ...m, content: m.content + delta } : m,
        ),
      },
    }));

  abortController = new AbortController();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        temporary
          ? {
              temporary: true,
              content: text,
              provider,
              model,
              // The server has no rows for this chat, so its prior turns
              // travel with the request.
              messages: (get().messagesByChat[id] ?? [])
                .filter((m) => m.role !== "system" && !m.id.startsWith("local-"))
                .map((m) => ({ role: m.role, content: m.content })),
              thinking,
              webSearch,
              knowledge: useKnowledge,
            }
          : {
              chatId: id,
              content: text,
              provider,
              model,
              thinking,
              webSearch,
              knowledge: useKnowledge,
            },
      ),
      signal: abortController.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.json().catch(() => null);
      // A message the server wrote for the user (maintenance, a disabled
      // model) is shown in the chat, so it is not also an app error.
      if (!detail?.error) console.error(`[ugnay] /api/chat failed (${res.status}).`);
      if (res.status === 401) {
        void recoverFromAuthFailure();
        throw new Error(
          detail?.error ?? "Your session has expired. Please sign in again to keep chatting.",
        );
      }
      throw new Error(detail?.error ?? `Request failed (${res.status}).`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError: string | null = null;
    let streamErrorAction: "change-model" | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;

        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event.type === "delta") appendDelta(event.text);
        else if (event.type === "reasoning") appendReasoning(event.text);
        else if (event.type === "sources" && Array.isArray(event.sources)) {
          const sources = event.sources as string[];
          set((s) => ({
            knowledgeSourcesByChat: { ...s.knowledgeSourcesByChat, [id]: sources },
          }));
        }
        else if (event.type === "error") {
          streamError = event.error;
          streamErrorAction = event.action === "change-model" ? "change-model" : null;
        }
        // A fallback kicked in: tell the user which model answered instead.
        else if (event.type === "notice") set({ error: event.notice });
      }
    }

    if (streamError) set({ error: streamError, errorAction: streamErrorAction });

    // Swap the optimistic rows for the persisted ones. A temporary chat has
    // none, so its in-memory transcript stays exactly as streamed.
    if (temporary) return;
    await get().loadMessages(id);
    const { data: fresh } = await supabase
      .from("chats")
      .select("title, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (fresh) {
      set((s) => ({
        chats: sortChats(
          s.chats.map((c) =>
            c.id === id ? { ...c, title: fresh.title, updated_at: fresh.updated_at } : c,
          ),
        ),
      }));
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      if (!temporary) await get().loadMessages(id);
    } else {
      set({
        error:
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "You appear to be offline. Reconnect and try again."
            : (err as Error).message,
      });
    }
  } finally {
    abortController = null;
    set({ streaming: false, streamingChatId: null });
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  userId: null,
  chats: [],
  projects: [],
  activeProjectId: null,
  panelProjectId: null,
  messagesByChat: {},
  activeChatId: null,
  settings: null,
  catalog: [],
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  temporaryChat: false,
  thinking: null,
  showThinking: true,
  webSearch: false,
  useKnowledge: false,
  reasoningByChat: {},
  knowledgeSourcesByChat: {},
  feedbackByMessage: {},
  hydrated: false,
  loadingMessages: false,
  streaming: false,
  streamingChatId: null,
  error: null,
  errorAction: null,
  modelPickerRequests: 0,
  artifact: null,
  sidebarOpen: false,

  async init(userId) {
    const supabase = createClient();
    // The store outlives route changes: ChatApp remounts on every navigation,
    // but an already-hydrated store still holds the same user's chats,
    // projects and settings, so re-running the queries would only duplicate
    // them. A different user (fresh page load) always hydrates.
    if (get().hydrated && get().userId === userId) return;
    set({ userId });

    const [chatsRes, projectsRes, settingsRes, catalogRes] = await Promise.all([
      // The hidden temporary chat is recorded in the database but never
      // listed, so History keeps its promise.
      supabase
        .from("chats")
        .select("*")
        .eq("is_temporary", false)
        .order("updated_at", { ascending: false }),
      supabase.from("projects").select("*").order("created_at", { ascending: true }),
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      fetch("/api/models")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (isUnrecoverableAuthError(chatsRes.error) || isUnrecoverableAuthError(settingsRes.error)) {
      void recoverFromAuthFailure();
      return;
    }
    if (chatsRes.error) reportSupabaseError("load your chats", chatsRes.error);
    if (projectsRes.error) reportSupabaseError("load your workspaces", projectsRes.error);
    if (settingsRes.error) reportSupabaseError("load your settings", settingsRes.error);

    let settings = settingsRes.data as UserSettings | null;
    if (!settings) {
      // The auth trigger normally creates this row; self-heal for older users.
      const { data } = await supabase
        .from("user_settings")
        .upsert({ user_id: userId }, { onConflict: "user_id" })
        .select("*")
        .single();
      settings = data as UserSettings | null;
    }

    const chats = (chatsRes.data ?? []) as Chat[];
    set({
      chats,
      projects: (projectsRes.data ?? []) as Project[],
      settings,
      catalog: catalogRes?.providers ?? [],
      provider: settings?.default_provider ?? DEFAULT_PROVIDER,
      model: settings?.default_model ?? DEFAULT_MODEL,
      hydrated: true,
    });

    // No conversation is selected here on purpose: a chat is only opened when
    // the user clicks it or the route names one (/?chat=<id>).
  },

  async loadMessages(chatId) {
    const supabase = createClient();
    set({ loadingMessages: true });

    // Ratings live in their own table; fetch them with the transcript so the
    // thumbs render in the state the user left them.
    void supabase
      .from("message_feedback")
      .select("message_id, rating")
      .eq("chat_id", chatId)
      .then(({ data, error }) => {
        if (error || !data) return;
        set((s) => ({
          feedbackByMessage: {
            ...s.feedbackByMessage,
            ...Object.fromEntries(data.map((row) => [row.message_id, row.rating])),
          },
        }));
      });
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });

    set((s) => ({
      loadingMessages: false,
      error: error ? "Could not load this conversation." : s.error,
      messagesByChat: error
        ? s.messagesByChat
        : { ...s.messagesByChat, [chatId]: (data ?? []) as Message[] },
    }));
  },

  async setActiveChat(chatId) {
    if (get().temporaryChat) get().setTemporaryChat(false);
    set({ activeChatId: chatId, error: null, sidebarOpen: false });
    if (!chatId) return;
    const chat = get().chats.find((c) => c.id === chatId);
    if (chat) {
      set({ provider: chat.provider, model: chat.model, activeProjectId: chat.project_id });
    }
    if (!get().messagesByChat[chatId]) await get().loadMessages(chatId);
  },

  newChat() {
    const { settings, temporaryChat } = get();
    if (temporaryChat) get().setTemporaryChat(false);
    set({
      activeChatId: null,
      activeProjectId: null,
      error: null,
      sidebarOpen: false,
      provider: settings?.default_provider ?? DEFAULT_PROVIDER,
      model: settings?.default_model ?? DEFAULT_MODEL,
    });
  },

  async createProject(name) {
    const clean = name.trim();
    const { userId } = get();
    if (!clean || !userId) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, name: clean })
      .select("*")
      .single();

    if (error || !data) {
      set({ error: reportSupabaseError("create this workspace", error) });
      if (isUnrecoverableAuthError(error)) void recoverFromAuthFailure();
      return;
    }

    // New workspaces open empty, ready for their first conversation.
    set((s) => ({
      projects: [...s.projects, data as Project],
      activeProjectId: (data as Project).id,
      activeChatId: null,
      error: null,
    }));
  },

  async renameProject(projectId, name) {
    const clean = name.trim();
    if (!clean) return;
    const previous = get().projects;
    set({
      projects: previous.map((p) => (p.id === projectId ? { ...p, name: clean } : p)),
    });

    const supabase = createClient();
    const { error } = await supabase.from("projects").update({ name: clean }).eq("id", projectId);
    if (error) {
      set({ projects: previous, error: reportSupabaseError("rename this workspace", error) });
    }
  },

  /** Workspace settings: the name and the instructions its chats are answered with. */
  async saveProject(projectId, patch) {
    const name = patch.name?.trim();
    const instructions = patch.instructions?.trim();
    const update: {
      name?: string;
      instructions?: string;
      default_provider?: string | null;
      default_model?: string | null;
      memory_enabled?: boolean;
    } = {};
    if (name) update.name = name;
    if (patch.instructions !== undefined) update.instructions = instructions ?? "";
    if (patch.default_provider !== undefined) update.default_provider = patch.default_provider;
    if (patch.default_model !== undefined) update.default_model = patch.default_model;
    if (patch.memory_enabled !== undefined) update.memory_enabled = patch.memory_enabled;
    if (Object.keys(update).length === 0) return;

    const previous = get().projects;
    set({ projects: previous.map((p) => (p.id === projectId ? { ...p, ...update } : p)) });

    const supabase = createClient();
    const { error } = await supabase.from("projects").update(update).eq("id", projectId);
    if (error) {
      set({ projects: previous, error: reportSupabaseError("save this workspace", error) });
    }
  },

  async deleteProject(projectId) {
    const { projects, chats, activeProjectId } = get();
    const remaining = projects.filter((p) => p.id !== projectId);
    // The conversations survive: the column is cleared, so they move to History.
    set({
      projects: remaining,
      chats: chats.map((c) => (c.project_id === projectId ? { ...c, project_id: null } : c)),
      activeProjectId: activeProjectId === projectId ? null : activeProjectId,
      panelProjectId: get().panelProjectId === projectId ? null : get().panelProjectId,
    });

    const supabase = createClient();
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (error) {
      set({ projects, chats, error: reportSupabaseError("delete this workspace", error) });
    }
  },

  setPanelProject(projectId) {
    set({ panelProjectId: projectId, sidebarOpen: false });
  },

  /**
   * Opens a workspace: new conversations go into it, and its most recent
   * conversation is reopened so the transcript is right there. Only a workspace
   * with no conversations yet lands on an empty composer.
   */
  async setActiveProject(projectId) {
    set({ activeProjectId: projectId, error: null, sidebarOpen: false });
    if (!projectId) return;

    const { activeChatId, chats } = get();
    const current = chats.find((c) => c.id === activeChatId);
    if (current?.project_id === projectId) return;

    // chats is kept newest-first, so the first match is the latest.
    const latest = chats.find((c) => c.project_id === projectId);
    if (!latest) {
      set({ activeChatId: null });
      return;
    }
    await get().setActiveChat(latest.id);
    // setActiveChat re-reads the project from the chat; keep this one open.
    set({ activeProjectId: projectId });
  },

  /** The "+" on a workspace row: a fresh conversation inside that workspace. */
  newChatInProject(projectId) {
    const { settings } = get();
    if (get().temporaryChat) get().setTemporaryChat(false);
    set({
      activeProjectId: projectId,
      activeChatId: null,
      error: null,
      sidebarOpen: false,
      provider: settings?.default_provider ?? DEFAULT_PROVIDER,
      model: settings?.default_model ?? DEFAULT_MODEL,
    });
  },

  async renameChat(chatId, title) {
    const clean = title.trim();
    if (!clean) return;
    const previous = get().chats;
    set({ chats: get().chats.map((c) => (c.id === chatId ? { ...c, title: clean } : c)) });

    const supabase = createClient();
    const { error } = await supabase.from("chats").update({ title: clean }).eq("id", chatId);
    if (error) set({ chats: previous, error: "Could not rename this chat." });
  },

  async deleteChat(chatId) {
    const { chats, activeChatId, messagesByChat } = get();
    const remaining = chats.filter((c) => c.id !== chatId);
    const nextMessages = { ...messagesByChat };
    delete nextMessages[chatId];
    set({ chats: remaining, messagesByChat: nextMessages });

    const supabase = createClient();
    const { error } = await supabase.from("chats").delete().eq("id", chatId);
    if (error) {
      set({ chats, messagesByChat, error: "Could not delete this chat." });
      return;
    }
    if (activeChatId === chatId) await get().setActiveChat(remaining[0]?.id ?? null);
  },

  /**
   * Branches a conversation. The turns up to and including `messageId` are
   * copied into a new chat, which records where it came from. The original is
   * never modified, so both conversations continue independently.
   */
  async setChatPinned(chatId, pinned) {
    await updateChatFlags(chatId, { pinned }, set, get);
  },

  async setChatArchived(chatId, archived) {
    await updateChatFlags(chatId, { archived }, set, get);
  },

  async branchFromMessage(messageId) {
    const { userId, activeChatId, messagesByChat, chats } = get();
    // A temporary chat has no rows to copy.
    if (!userId || !activeChatId || activeChatId === TEMPORARY_CHAT_ID) return;

    const source = chats.find((c) => c.id === activeChatId);
    const history = messagesByChat[activeChatId] ?? [];
    const cut = history.findIndex((m) => m.id === messageId);
    if (!source || cut === -1) return;

    // Optimistic rows have local ids and are not in the database yet.
    const carried = history.slice(0, cut + 1).filter((m) => !m.id.startsWith("local-"));
    if (carried.length === 0) return;

    const supabase = createClient();
    const base = source.title.replace(/\s*\(branch(?: \d+)?\)$/, "").trim();
    const { data: created, error: chatError } = await supabase
      .from("chats")
      .insert({
        user_id: userId,
        title: `${base || DEFAULT_CHAT_TITLE} (branch)`.slice(0, 200),
        provider: source.provider,
        model: source.model,
        system_prompt: source.system_prompt,
        project_id: source.project_id,
        branched_from_chat_id: source.id,
        branched_from_message_id: messageId,
      })
      .select("*")
      .single();

    if (chatError || !created) {
      set({ error: reportSupabaseError("branch this conversation", chatError) });
      if (isUnrecoverableAuthError(chatError)) void recoverFromAuthFailure();
      return;
    }

    const branch = created as Chat;
    // created_at is carried over so the copied turns keep their original order.
    const { data: copied, error: messageError } = await supabase
      .from("messages")
      .insert(
        carried.map((m) => ({
          chat_id: branch.id,
          user_id: userId,
          role: m.role,
          content: m.content,
          provider: m.provider,
          model: m.model,
          prompt_tokens: m.prompt_tokens,
          completion_tokens: m.completion_tokens,
          total_tokens: m.total_tokens,
          created_at: m.created_at,
        })),
      )
      .select("*");

    if (messageError) {
      // Leaving an empty branch behind would be confusing; undo it.
      await supabase.from("chats").delete().eq("id", branch.id);
      set({ error: reportSupabaseError("branch this conversation", messageError) });
      return;
    }

    set((state) => ({
      chats: sortChats([branch, ...state.chats]),
      messagesByChat: {
        ...state.messagesByChat,
        [branch.id]: ((copied ?? []) as Message[]).slice().sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        ),
      },
      activeChatId: branch.id,
      error: null,
    }));
  },

  async setChatSystemPrompt(chatId, prompt) {
    const value = prompt && prompt.trim() ? prompt.trim() : null;
    const previous = get().chats;
    set({ chats: get().chats.map((c) => (c.id === chatId ? { ...c, system_prompt: value } : c)) });

    const supabase = createClient();
    const { error } = await supabase.from("chats").update({ system_prompt: value }).eq("id", chatId);
    if (error) set({ chats: previous, error: "Could not save the chat instructions." });
  },

  async refreshCatalog() {
    // Admin can disable a model while someone is chatting. Only the list of
    // choices changes here — no chat, message or setting is touched, so the
    // conversation on screen is untouched too.
    const data = await fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!data?.providers) return;
    const next = data.providers as ProviderCatalogEntry[];
    const current = get().catalog;
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    set({ catalog: next });
  },

  async setModel(provider, model) {
    set({ provider, model });
    const { activeChatId, temporaryChat } = get();

    // A draft or a temporary chat has no row to update; the store values above
    // are what the next request uses.
    if (!activeChatId || temporaryChat || activeChatId === TEMPORARY_CHAT_ID) return;

    set({ chats: get().chats.map((c) => (c.id === activeChatId ? { ...c, provider, model } : c)) });
    const supabase = createClient();
    const { error } = await supabase
      .from("chats")
      .update({ provider, model })
      .eq("id", activeChatId);
    if (error) reportSupabaseError("switch the model for this chat", error);
  },

  async saveSettings(patch) {
    const { userId, settings } = get();
    if (!userId) return;
    const previous = settings;
    set({ settings: settings ? ({ ...settings, ...patch } as UserSettings) : settings });

    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
      .select("*")
      .single();

    if (error) {
      set({ settings: previous, error: reportSupabaseError("save your settings", error) });
      if (isUnrecoverableAuthError(error)) void recoverFromAuthFailure();
      return;
    }
    set({ settings: data as UserSettings });
  },

  async sendMessage(content) {
    const text = content.trim();
    // `sendInFlight` is checked and set synchronously, before any await. The
    // visible `streaming` flag only turns on inside runSend — after the
    // optimistic append and, for a brand-new chat, after the awaited row
    // insert — so a double-clicked send, regenerate or resend could otherwise
    // slip a second turn through that gap and duplicate the exchange.
    if (!text || get().streaming || sendInFlight) return;
    sendInFlight = true;
    try {
      await runSend(text, set, get);
    } finally {
      sendInFlight = false;
    }
  },

  stopStreaming() {
    abortController?.abort();
  },

  /**
   * Toggling temporary mode always starts a fresh, unsaved conversation and
   * throws away the previous temporary transcript — it exists only in memory.
   */
  setTemporaryChat(on) {
    set((s) => {
      const messagesByChat = { ...s.messagesByChat };
      delete messagesByChat[TEMPORARY_CHAT_ID];
      return {
        temporaryChat: on,
        error: null,
        activeChatId: on ? TEMPORARY_CHAT_ID : null,
        messagesByChat: on ? { ...messagesByChat, [TEMPORARY_CHAT_ID]: [] } : messagesByChat,
        provider: s.settings?.default_provider ?? s.provider,
        model: s.settings?.default_model ?? s.model,
      };
    });
  },

  setThinking(effort) {
    set({ thinking: effort });
  },

  setShowThinking(on) {
    set({ showThinking: on });
  },

  setWebSearch(on) {
    set({ webSearch: on });
  },

  setUseKnowledge(on) {
    set({ useKnowledge: on });
  },

  /**
   * Records a thumbs rating. Stored only while "Improve the model" is on — with
   * it off the rating stays in the UI and nothing is submitted.
   */
  async rateMessage(messageId, rating) {
    const { userId, settings, activeChatId, temporaryChat } = get();

    set((s) => {
      const next = { ...s.feedbackByMessage };
      if (rating) next[messageId] = rating;
      else delete next[messageId];
      return { feedbackByMessage: next };
    });

    // A temporary chat has no rows to attach feedback to, and a local
    // (optimistic) message id is not a real row yet.
    if (!userId || !activeChatId || temporaryChat) return;
    if (!settings?.improve_model) return;
    if (messageId.startsWith("local-")) return;

    const supabase = createClient();
    if (!rating) {
      const { error } = await supabase
        .from("message_feedback")
        .delete()
        .eq("message_id", messageId);
      if (error) reportSupabaseError("remove your feedback", error);
      return;
    }

    const { error } = await supabase.from("message_feedback").upsert(
      { message_id: messageId, user_id: userId, chat_id: activeChatId, rating },
      { onConflict: "message_id" },
    );
    if (error) reportSupabaseError("save your feedback", error);
  },

  /** Rewrites a message the user already sent. Temporary chats stay in memory. */
  async editMessage(messageId, content) {
    const text = content.trim();
    const { activeChatId, temporaryChat } = get();
    if (!text || !activeChatId) return;

    const previous = get().messagesByChat[activeChatId] ?? [];
    set((s) => ({
      messagesByChat: {
        ...s.messagesByChat,
        [activeChatId]: previous.map((m) => (m.id === messageId ? { ...m, content: text } : m)),
      },
    }));

    if (temporaryChat || messageId.startsWith("local-")) return;

    const supabase = createClient();
    const { error } = await supabase
      .from("messages")
      .update({ content: text })
      .eq("id", messageId);

    if (error) {
      set((s) => ({
        messagesByChat: { ...s.messagesByChat, [activeChatId]: previous },
        error: reportSupabaseError("edit this message", error),
      }));
    }
  },

  /**
   * Rewrites a prompt and asks for a fresh reply: this turn and everything after
   * it are dropped, then the edited text is sent through the normal path.
   */
  async resendMessage(messageId, content) {
    const text = content.trim();
    const { activeChatId, temporaryChat, streaming } = get();
    if (!text || !activeChatId || streaming) return;

    const messages = get().messagesByChat[activeChatId] ?? [];
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;

    const cutoff = messages[index].created_at;
    const kept = messages.slice(0, index);
    set((s) => ({ messagesByChat: { ...s.messagesByChat, [activeChatId]: kept } }));

    // A temporary conversation has no rows to remove.
    if (!temporaryChat && !messageId.startsWith("local-")) {
      const supabase = createClient();
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("chat_id", activeChatId)
        .gte("created_at", cutoff);

      if (error) {
        // Put the transcript back rather than leaving a half-truncated view.
        set((s) => ({
          messagesByChat: { ...s.messagesByChat, [activeChatId]: messages },
          error: reportSupabaseError("resend this message", error),
        }));
        return;
      }
    }

    await get().sendMessage(text);
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },

  setError(error) {
    set({ error, errorAction: error ? get().errorAction : null });
  },

  openModelPicker() {
    set((s) => ({ modelPickerRequests: s.modelPickerRequests + 1 }));
  },

  openArtifact(language, code) {
    set({ artifact: { language, code } });
  },

  closeArtifact() {
    set({ artifact: null });
  },
}));

/** Built-in presets plus whatever the user saved. */
export function allPresets(settings: UserSettings | null): Preset[] {
  const custom = Array.isArray(settings?.presets) ? settings!.presets : [];
  return [...BUILTIN_PRESETS, ...custom.filter((p) => !p.builtin)];
}
