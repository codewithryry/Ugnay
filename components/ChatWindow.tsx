"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, EyeOff, PanelLeft, WifiOff, X } from "lucide-react";
import type { CurrentUser } from "./ChatApp";
import ChatHeaderMenu from "./ChatHeaderMenu";
import Composer from "./Composer";
import MessageList from "./MessageList";
import { cn } from "@/lib/utils";
import { GREETING_STORAGE_KEY, pickGreeting, type Greeting } from "@/lib/greetings";
import { useChatStore } from "@/store/chatStore";

export default function ChatWindow({
  user,
  hydrated,
}: {
  user: CurrentUser;
  hydrated: boolean;
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

        <span className="flex min-w-0 items-center gap-1.5 px-1 md:hidden">
          <Image
            src="/logo/logo-192.png"
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] shrink-0 rounded-md"
          />
          <span className="truncate font-display text-sm font-semibold tracking-tight text-neutral-100">
            Ugnay
          </span>
        </span>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 md:gap-1.5">
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
          className="flex items-center justify-center gap-2 bg-amber-950/60 px-4 py-2 text-xs text-amber-300"
        >
          <WifiOff className="h-3.5 w-3.5" aria-hidden />
          You are offline. Messages will fail until the connection is back.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-3xl items-start gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-xs text-red-200"
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
              className="shrink-0 rounded-lg border border-red-900/60 px-2 py-1 text-[11px] text-red-100 transition hover:bg-red-950/60"
            >
              Change model
            </button>
          )}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="rounded p-0.5 text-red-300 hover:text-red-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}

      {isEmpty && !loadingMessages ? (
        // Empty state: greeting and composer centred together as one block.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <EmptyState
            hydrated={hydrated}
            name={user.nickname?.trim() || user.displayName}
            chatKey={activeChatId}
          />
          <Composer centered />
        </div>
      ) : (
        <>
          <MessageList
            messages={messages ?? []}
            loading={loadingMessages && !messages?.length}
            streaming={streaming}
            user={user}
          />
          <Composer centered={false} />
        </>
      )}
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
  hydrated,
  name,
  chatKey,
}: {
  hydrated: boolean;
  name: string;
  chatKey: string | null;
}) {
  // Both the clock and the random pick are resolved after mount so the server
  // render (different timezone, different roll) cannot mismatch on hydration.
  const [greeting, setGreeting] = useState<Greeting | null>(null);
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
    <div className="flex w-full flex-col items-center px-4 pb-1">
      <div className="min-h-[4.5rem] text-center sm:min-h-[5.5rem]">
        {hydrated && greeting && (
          <div className="animate-fade-in">
            <h1 className="text-[1.65rem] font-semibold tracking-tight text-neutral-100 xs:text-3xl sm:text-[2.6rem]">
              {greeting.headline}
            </h1>
          </div>
        )}
      </div>
    </div>
  );
}
