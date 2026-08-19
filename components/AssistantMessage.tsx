"use client";

import { memo, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";
import MessageActions from "./MessageActions";
import type { Message } from "@/types/db";
import { useChatStore } from "@/store/chatStore";

function AssistantMessageImpl({
  message,
  streaming,
  onRegenerate,
}: {
  message: Message;
  streaming: boolean;
  /** Only the latest response can be regenerated. */
  onRegenerate?: () => void;
}) {
  const isThinking = streaming && !message.content;
  const sharingEnabled = useChatStore((s) => s.settings?.share_links_enabled ?? true);
  const showThinking = useChatStore((s) => s.showThinking);
  const reasoning = useChatStore((s) => s.reasoningByChat[message.chat_id] ?? "");

  // Built after mount so the server render cannot mismatch on the origin.
  const [shareUrl, setShareUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setShareUrl(`${window.location.origin}/?chat=${message.chat_id}`);
  }, [message.chat_id]);

  return (
    <div className="group flex w-full min-w-0 flex-col items-start animate-fade-in">
      {/* Reasoning arrives only while streaming and is never stored. */}
      {showThinking && streaming && reasoning && (
        <details open className="mb-3 w-full rounded-xl border border-ink-800 bg-ink-900 px-3 py-2">
          <summary className="cursor-pointer text-xs text-neutral-400">Thinking…</summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-neutral-500">
            {reasoning}
          </p>
        </details>
      )}

      {isThinking ? (
        <span className="flex items-center gap-1.5 py-1 text-sm text-neutral-500">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
          <span className="sr-only">Ugnay is responding</span>
        </span>
      ) : (
        <div className="prose-ugnay w-full min-w-0 max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code({ className, children, ...props }) {
                const text = String(children).replace(/\n$/, "");
                const language = /language-(\w+)/.exec(className ?? "")?.[1];
                // Inline code has no language class and no newlines.
                if (!language && !text.includes("\n")) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }
                return <CodeBlock language={language ?? ""} code={text} />;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
          {streaming && (
            <span
              className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-neutral-300 align-middle"
              aria-hidden
            />
          )}
        </div>
      )}

      {!streaming && message.content && (
        <MessageActions
          messageId={message.id}
          content={message.content}
          shareUrl={sharingEnabled ? shareUrl : undefined}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-500"
      style={{ animationDelay: delay }}
      aria-hidden
    />
  );
}

export default memo(AssistantMessageImpl);
