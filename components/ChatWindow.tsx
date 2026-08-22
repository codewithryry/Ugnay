"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, EyeOff, PanelLeft, WifiOff, X } from "lucide-react";
import type { CurrentUser } from "./ChatApp";
import ChatHeaderMenu from "./ChatHeaderMenu";
import Composer from "./Composer";
import MessageList from "./MessageList";
import { cn, DEFAULT_CHAT_TITLE } from "@/lib/utils";
import { FALLBACK_GREETING, GREETING_STORAGE_KEY, pickGreeting, type Greeting } from "@/lib/greetings";
import { useChatStore } from "@/store/chatStore";
import { useIsCompact } from "./useIsCompact";

export default function ChatWindow({
  user,
}: {
  user: CurrentUser;
}) {
  const activeChatId = useChatStore((s) => s.activeChatId);
  const messages = useChatStore((s) => (activeChatId ? s.messagesByChat[activeChatId] : undefined));
  const loadingMessages = useChatStore((s) => s.loadingMessages);
  const streaming = useChatStore((s) => s.streaming);
  const error = useChatStore((s) => s.error);
  const errorAction = useChatStore((s) => s.errorAction);
  const openModelPicker = useChatStore((s) => s.openModelPicker);
  const setError = useChatStore((s) => s.setError);
  const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
  const compact = useIsCompact();

  const [offline, setOffline] = useState(false);
  const [shared, setShared] = useState(false);
  const temporaryChat = useChatStore((s) => s.temporaryChat);

  const chats = useChatStore((s) => s.chats);
  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  // Same link the message actions copy, so sharing behaviour stays consistent.
  async function shareChat() {
    if (!activeChat) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?chat=${activeChat.id}`);
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    } catch {
      // Clipboard blocked (insecure context or denied permission).
    }
  }

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const isEmpty = !activeChatId || (messages?.length ?? 0) === 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-[3.5rem] shrink-0 items-center gap-1 px-2 pt-safe md:h-14 md:gap-2 md:px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
          aria-controls="chat-sidebar"
          className="shrink-0 rounded-lg p-2.5 text-neutral-400 hover:bg-ink-850 hover:text-neutral-100 md:hidden"
        >
          <PanelLeft className="h-4 w-4" aria-hidden />
        </button>

        {/* The open conversation, so the bar is not half empty. */}
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-neutral-300 md:px-2">
          {!isEmpty && activeChat && activeChat.title !== DEFAULT_CHAT_TITLE ? activeChat.title : ""}
        </h2>

        <div className="flex min-w-0 shrink-0 items-center gap-1 md:gap-1.5">
          <Link
            href="/upgrade"
            className="shrink-0 rounded-full border border-ink-700 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-850 md:px-3"
          >
            Upgrade
          </Link>

          {/* Stays visible during a temporary conversation so it can be exited. */}
          {(isEmpty || temporaryChat) && <TemporaryChatToggle />}

          {!isEmpty && activeChat && (
            <>
              <button
                type="button"
                onClick={() => void shareChat()}
                className="shrink-0 rounded-full border border-ink-700 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-850 md:px-3"
              >
                {shared ? "Link copied" : "Share"}
              </button>
              <ChatHeaderMenu chatId={activeChat.id} title={activeChat.title} />
            </>
          )}
        </div>
      </header>

      {offline && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-warning/20 bg-warning-soft px-4 py-2 text-xs text-warning"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          You are offline. Messages will fail until the connection is back.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="animate-fade-in mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-xs text-danger"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          {errorAction === "change-model" && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                openModelPicker();
              }}
              className="shrink-0 rounded-lg border border-danger/30 px-2 py-1 text-[11px] font-medium text-danger transition hover:bg-danger/10"
            >
              Change model
            </button>
          )}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="rounded p-0.5 text-danger/70 transition hover:text-danger"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {isEmpty && !loadingMessages ? (
        compact ? (
          // PWA: the greeting sits alone in the middle of the screen and the
          // composer stays docked at the bottom, as it is once a chat starts.
          <>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <EmptyState
                name={user.nickname?.trim() || user.displayName}
                chatKey={activeChatId}
                compact
              />
            </div>
            {temporaryChat && <TemporaryNotice />}
            <Composer centered={false} />
          </>
        ) : (
          // Desktop: greeting and composer centred together as one block.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <EmptyState
              name={user.nickname?.trim() || user.displayName}
              chatKey={activeChatId}
            />
            {temporaryChat && <TemporaryNotice />}
            <Composer centered />
          </div>
        )
      ) : (
        <>
          <MessageList
            messages={messages ?? []}
            loading={loadingMessages && !messages?.length}
            streaming={streaming}
            user={user}
          />
          {temporaryChat && <TemporaryNotice />}
          <Composer centered={false} />
        </>
      )}
    </div>
  );
}

/** The standing notice shown while a temporary chat is active. */
function TemporaryNotice() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-4 py-2 text-xs text-neutral-500"
    >
      <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
      This chat won&apos;t appear in your history and will not be used to train models.
    </div>
  );
}

/**
 * Temporary chat control. When on, nothing about the conversation is written to
 * Supabase: no chat row, no messages, and cross-chat memory is skipped.
 */
function TemporaryChatToggle() {
  const temporaryChat = useChatStore((s) => s.temporaryChat);
  const setTemporaryChat = useChatStore((s) => s.setTemporaryChat);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        role="switch"
        aria-checked={temporaryChat}
        aria-label="Temporary chat"
        title="Temporary chat"
        onClick={() => setTemporaryChat(!temporaryChat)}
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
        onFocus={() => setShowInfo(true)}
        onBlur={() => setShowInfo(false)}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition sm:px-3",
          temporaryChat
            ? "border-neutral-400 bg-ink-800 text-neutral-100"
            : "border-ink-700 text-neutral-300 hover:bg-ink-850",
        )}
      >
        <EyeOff className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden sm:inline">Temporary chat</span>
      </button>

      {showInfo && (
        <span
          role="tooltip"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-40 w-[min(15rem,calc(100vw-2rem))] rounded-xl border border-ink-700 bg-ink-850 px-3 py-2 text-[11px] leading-relaxed text-neutral-300 shadow-2xl"
        >
          This chat won&apos;t appear in history or be used to train our models.
        </span>
      )}
    </div>
  );
}

/** Display names are often email-derived; the first token reads more naturally. */
function firstName(name: string) {
  const first = name.trim().split(/[\s.]+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

function EmptyState({
  name,
  chatKey,
  compact = false,
}: {
  name: string;
  chatKey: string | null;
  /** PWA variant: one quiet centred line instead of the desktop hero. */
  compact?: boolean;
}) {
  // A fixed line renders from the very first paint, so the hero is never
  // blank. The clock and the random pick are resolved after mount — the server
  // render (different timezone, different roll) cannot mismatch on hydration —
  // and replace the fallback once ready.
  const [greeting, setGreeting] = useState<Greeting>(FALLBACK_GREETING);
  const who = firstName(name);

  useEffect(() => {
    // The previous pick is remembered across reloads, so a line never repeats
    // back to back even on a fresh page load.
    let previous: { headline: string; subtitle: string } | null = null;
    try {
      const stored = localStorage.getItem(GREETING_STORAGE_KEY);
      if (stored) previous = JSON.parse(stored);
    } catch {
      // Storage blocked or corrupt; a random pick is still fine.
    }

    const next = pickGreeting({ hour: new Date().getHours(), name: who, previous });
    setGreeting(next);

    try {
      localStorage.setItem(GREETING_STORAGE_KEY, JSON.stringify(next.keys));
    } catch {
      // Non-fatal: repeats are only avoided within this session then.
    }
  }, [chatKey, who]);

  return (
    <div className={cn("flex w-full flex-col items-center px-4", !compact && "pb-1")}>
      <div className={cn("text-center", !compact && "min-h-[4.5rem] sm:min-h-[5.5rem]")}>
        <div className="animate-fade-in">
          <h1
            className={cn(
              "tracking-tight text-neutral-100",
              compact
                ? "text-lg font-normal"
                : "text-[1.65rem] font-semibold xs:text-3xl sm:text-[2.6rem]",
            )}
          >
            {greeting.headline}
          </h1>
        </div>
      </div>
    </div>
  );
}
