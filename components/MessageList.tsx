"use client";

import { useEffect, useRef } from "react";
import AssistantMessage from "./AssistantMessage";
import UserMessage from "./UserMessage";
import type { CurrentUser } from "./ChatApp";
import type { Message } from "@/types/db";
import { useChatStore } from "@/store/chatStore";

export default function MessageList({
  messages,
  loading,
  streaming,
  user,
}: {
  messages: Message[];
  loading: boolean;
  streaming: boolean;
  user: CurrentUser;
}) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const autoScroll = useChatStore((s) => s.settings?.auto_scroll ?? true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Only auto-scroll while the user is already near the bottom, so reading
  // back through history isn't hijacked by an in-flight stream.
  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // Regenerating re-sends the prompt that produced the last reply.
  const lastPrompt = [...messages].reverse().find((m) => m.role === "user")?.content ?? null;

  const lastContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    if (autoScroll && pinnedRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [autoScroll, messages.length, lastContent]);

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-4">
        <div className="mx-auto w-full max-w-3xl space-y-6" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-ink-850" />
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-ink-850" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-ink-850" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-6 sm:px-4 sm:py-7"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-7 sm:gap-6">
        {messages
          .filter((m) => m.role !== "system")
          .map((message, index, all) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} user={user} />
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                streaming={streaming && index === all.length - 1}
                onRegenerate={
                  index === all.length - 1 && lastPrompt && !streaming
                    ? () => void sendMessage(lastPrompt)
                    : undefined
                }
              />
            ),
          )}
        <div ref={bottomRef} className="h-px" />
      </div>
    </div>
  );
}
