"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import type { CurrentUser } from "./ChatApp";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import type { Message } from "@/types/db";

const actionClass =
  "flex items-center gap-1.5 rounded-md p-2.5 text-[11px] sm:px-1.5 sm:py-1 text-neutral-500 transition hover:bg-ink-850 hover:text-neutral-200";

export default function UserMessage({
  message,
  user,
}: {
  message: Message;
  user: CurrentUser;
}) {
  const editMessage = useChatStore((s) => s.editMessage);
  const resendMessage = useChatStore((s) => s.resendMessage);
  const streaming = useChatStore((s) => s.streaming);

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(message.content);
  }, [message.content]);

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / denied permission) — stay silent.
    }
  }

  /** Save the edit only; the existing reply stays as it is. */
  function commit() {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === message.content) {
      setDraft(message.content);
      return;
    }
    void editMessage(message.id, text);
  }

  /** Save and ask again: this turn and everything after it are replaced. */
  function commitAndResend() {
    const text = draft.trim();
    setEditing(false);
    if (!text) {
      setDraft(message.content);
      return;
    }
    void resendMessage(message.id, text);
  }

  return (
    <div className="group flex flex-col items-end animate-fade-in">
      {editing ? (
        <div className="w-full max-w-[95%] rounded-2xl border border-ink-700 bg-ink-900 p-2 sm:max-w-[75%]">
          <label htmlFor={`edit-${message.id}`} className="sr-only">
            Edit your message
          </label>
          <textarea
            id={`edit-${message.id}`}
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(message.content);
                setEditing(false);
              }
              // Cmd/Ctrl+Enter is the "ask again" shortcut, matching the composer.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitAndResend();
            }}
            className="field-seamless max-h-64 w-full resize-none px-2 py-1 text-base leading-7 text-neutral-100 focus:outline-none focus:ring-0 sm:text-[15px]"
          />
          <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
              className="rounded-full px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded-full border border-ink-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={commitAndResend}
              disabled={streaming}
              title="Replaces this turn and everything after it"
              className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-60"
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      ) : (
        <div
          className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-ink-800 px-3.5 py-2.5 text-[15px] leading-7 text-neutral-100 [overflow-wrap:anywhere] sm:max-w-[75%] sm:px-4"
          aria-label={`Message from ${user.displayName}`}
        >
          {message.content}
        </div>
      )}

      {!editing && (
        <div className="touch-visible mt-1.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => void copy()}
            title={copied ? "Copied" : "Copy message"}
            aria-label={copied ? "Message copied" : "Copy message"}
            className={cn(actionClass, copied && "text-neutral-200")}
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
          </button>

          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={streaming}
            title="Edit message"
            aria-label="Edit message"
            className={cn(actionClass, "disabled:cursor-not-allowed disabled:opacity-50")}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
