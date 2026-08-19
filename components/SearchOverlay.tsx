"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus, Search } from "lucide-react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";
import { cn, dateGroupOf, groupByDate } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

/**
 * Search dialog over the app: query field, actions and date-grouped
 * conversations on the left, a preview of the highlighted chat on the right.
 * Titles come from the store; the preview is fetched on demand under RLS.
 */
export default function SearchOverlay({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const chats = useChatStore((s) => s.chats);
  const hydrated = useChatStore((s) => s.hydrated);
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const newChat = useChatStore((s) => s.newChat);

  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ role: string; content: string }[] | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  }, [chats, query]);

  const groups = useMemo(() => groupByDate(results, (c) => c.updated_at), [results]);
  const previewChat = chats.find((c) => c.id === previewId) ?? null;

  // Load the highlighted conversation's opening turns for the right pane.
  useEffect(() => {
    if (!previewId) {
      setPreview(null);
      return;
    }
    let active = true;
    setLoadingPreview(true);
    void createClient()
      .from("messages")
      .select("role, content")
      .eq("chat_id", previewId)
      .order("created_at", { ascending: true })
      .limit(6)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error("[ugnay] Could not load the preview:", error);
        setPreview(data ?? []);
        setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [previewId]);

  function open(chatId: string) {
    void setActiveChat(chatId);
    onClose();
  }

  function startChat() {
    newChat();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Search"
      hideHeader
      panelClassName="max-w-4xl h-[92dvh] sm:h-[560px]"
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 px-4 py-4 sm:px-5">
        <label htmlFor="chat-search" className="sr-only">
          Search chats
        </label>
        <input
          id="chat-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="field-seamless w-full min-w-0 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-0 sm:text-[15px]"
        />
        <Search className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-ink-800 p-2 md:max-w-sm md:border-r">
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] uppercase tracking-wide text-neutral-600">
            Actions
          </p>
          <button
            type="button"
            onClick={startChat}
            className="flex w-full items-center gap-2.5 rounded-lg bg-ink-850 px-2.5 py-2.5 text-left text-sm text-neutral-100 transition hover:bg-ink-800"
          >
            <MessageSquarePlus className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
            Start a new chat
          </button>

          {!hydrated && (
            <ul className="mt-3 space-y-1.5 px-1" aria-hidden>
              {Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="h-9 animate-pulse rounded-lg bg-ink-850" />
              ))}
            </ul>
          )}

          {hydrated && results.length === 0 && (
            <p className="px-2.5 pt-4 text-xs leading-relaxed text-neutral-500">
              {chats.length === 0
                ? "No conversations yet. Start one and it will show up here."
                : `No conversations match “${query.trim()}”.`}
            </p>
          )}

          {groups.map((group) => (
            <div key={group.label} className="mt-3">
              <p className="px-2.5 pb-1 text-[11px] uppercase tracking-wide text-neutral-600">
                {group.label}
              </p>
              <ul>
                {group.items.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      onClick={() => open(chat.id)}
                      onMouseEnter={() => setPreviewId(chat.id)}
                      onFocus={() => setPreviewId(chat.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition",
                        previewId === chat.id ? "bg-ink-850" : "hover:bg-ink-850",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                        {chat.title}
                      </span>
                      <span className="hidden shrink-0 text-xs text-neutral-600 xs:inline">
                        {dateGroupOf(chat.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-y-auto p-5 md:block">
          {!previewChat ? (
            <p className="flex h-full items-center justify-center text-sm text-neutral-600">
              Select a conversation to preview
            </p>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-neutral-100">{previewChat.title}</h2>
              <p className="mt-1 text-xs text-neutral-600">
                {previewChat.model} · updated {dateGroupOf(previewChat.updated_at).toLowerCase()}
              </p>

              {loadingPreview && (
                <div className="mt-4 space-y-2" aria-hidden>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-3.5 animate-pulse rounded bg-ink-850" />
                  ))}
                </div>
              )}

              {!loadingPreview && preview?.length === 0 && (
                <p className="mt-4 text-xs text-neutral-500">This conversation is empty.</p>
              )}

              <div className="mt-4 space-y-3">
                {preview
                  ?.filter((m) => m.role !== "system")
                  .map((message, index) => (
                    <div key={index}>
                      <p className="text-[11px] uppercase tracking-wide text-neutral-600">
                        {message.role === "user" ? "You" : "Ugnay"}
                      </p>
                      <p className="mt-0.5 line-clamp-4 text-xs leading-relaxed text-neutral-400">
                        {message.content}
                      </p>
                    </div>
                  ))}
              </div>

              <button
                type="button"
                onClick={() => open(previewChat.id)}
                className="mt-5 rounded-full border border-ink-700 px-3.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800"
              >
                Open conversation
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
