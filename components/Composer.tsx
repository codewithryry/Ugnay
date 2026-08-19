"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, Globe, Loader2, Mic, Plus, Square } from "lucide-react";
import ModelSelector from "./ModelSelector";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { useDictation } from "./useDictation";

const MAX_HEIGHT = 200;

/** Compact on/off control inside the composer's bottom row. */
function ToolChip({
  label,
  icon: Icon,
  active,
  onClick,
  title,
}: {
  /** Omit for an icon-only chip; `title` still names it for assistive tech. */
  label?: string;
  icon: typeof Plus;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition",
        active
          ? "border-neutral-400 bg-ink-800 text-neutral-100"
          : "border-ink-700 text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

export default function Composer({ centered }: { centered: boolean }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const streaming = useChatStore((s) => s.streaming);
  const hydrated = useChatStore((s) => s.hydrated);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const cmdEnterToSubmit = useChatStore((s) => s.settings?.cmd_enter_to_submit ?? false);
  const thinking = useChatStore((s) => s.thinking);
  const setThinking = useChatStore((s) => s.setThinking);
  const webSearch = useChatStore((s) => s.webSearch);
  const setWebSearch = useChatStore((s) => s.setWebSearch);
  const richText = useChatStore((s) => s.settings?.rich_text_editor ?? false);
  const dictationMode = useChatStore((s) => s.settings?.dictation_refinement ?? "none");

  // Dictation inserts at the caret; refinement is applied by /api/refine unless
  // the user chose "No refinement".
  const dictation = useDictation({
    refine: dictationMode !== "none",
    onText: (text) =>
      setValue((current) => {
        const separator = current && !current.endsWith(" ") ? " " : "";
        return `${current}${separator}${text}`;
      }),
  });

  // Grow with the content, up to a cap, then scroll.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming, activeChatId]);

  /**
   * Rich text editor behaviour, on when Settings → Behavior → "Enable Rich Text
   * Editor" is set: newlines continue lists and close code fences. The field
   * stays a textarea, so shortcuts, IME input and sending are unchanged.
   */
  function handleRichNewline(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    const caret = el.selectionStart;
    if (caret !== el.selectionEnd) return false;

    const before = value.slice(0, caret);
    const line = before.slice(before.lastIndexOf("\n") + 1);

    // An opening fence gains its closing fence, with the caret between them.
    const fence = /^\s*```[\w-]*$/.exec(line);
    if (fence) {
      const insert = "\n\n```";
      event.preventDefault();
      const next = `${before}${insert}${value.slice(caret)}`;
      setValue(next);
      requestAnimationFrame(() => {
        const position = caret + 1;
        el.setSelectionRange(position, position);
      });
      return true;
    }

    // Continue "- ", "* " and "1. " lists; an empty item ends the list.
    const bullet = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      const [, indent, marker, rest] = bullet;
      event.preventDefault();
      if (!rest.trim()) {
        // Empty item: drop the marker instead of repeating it.
        const lineStart = before.lastIndexOf("\n") + 1;
        const next = `${value.slice(0, lineStart)}\n${value.slice(caret)}`;
        setValue(next);
        requestAnimationFrame(() => el.setSelectionRange(lineStart + 1, lineStart + 1));
        return true;
      }
      const nextMarker = /^\d+\.$/.test(marker)
        ? `${Number.parseInt(marker, 10) + 1}.`
        : marker;
      const insert = `\n${indent}${nextMarker} `;
      const next = `${before}${insert}${value.slice(caret)}`;
      setValue(next);
      requestAnimationFrame(() => {
        const position = caret + insert.length;
        el.setSelectionRange(position, position);
      });
      return true;
    }

    return false;
  }

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    setValue("");
    void sendMessage(text);
  }

  return (
    <div
      className={cn(
        // pb-safe clears the iOS home indicator when installed as a PWA.
        "w-full px-3 pb-safe sm:px-4",
        centered ? "pb-2 pt-1" : "pb-4 pt-1 sm:pb-5",
      )}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mx-auto w-full max-w-3xl"
      >
        <div className="rounded-3xl border border-ink-700 bg-ink-900 p-2 shadow-lg transition focus-within:border-ink-600">
          <label htmlFor="composer" className="sr-only">
            Message Ugnay
          </label>
          <textarea
            id="composer"
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={!hydrated}
            placeholder={centered ? "Ask Ugnay anything…" : "Message Ugnay…"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              const withModifier = e.metaKey || e.ctrlKey;
              const sends = cmdEnterToSubmit ? withModifier : !e.shiftKey && !withModifier;
              if (sends) {
                e.preventDefault();
                submit();
                return;
              }
              // This Enter inserts a newline: let the rich text editor shape it.
              if (richText) handleRichNewline(e);
            }}
            className="field-seamless max-h-[200px] w-full resize-none px-2.5 pb-1 pt-2 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-0 disabled:opacity-50 sm:text-[15px]"
          />

          <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
            {/* Attachments are not implemented yet; the control keeps its place. */}
            <span
              aria-disabled
              title="Attachments — not available yet"
              className="flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full border border-ink-700 text-neutral-600"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </span>

            {/* Reasoning: off → medium effort. Providers without reasoning ignore it. */}
            <ToolChip
              label="Thinking"
              icon={Brain}
              active={thinking !== null}
              onClick={() => setThinking(thinking ? null : "medium")}
              title="Ask the model to reason before answering"
            />

            <ToolChip
              label="Web search"
              icon={Globe}
              active={webSearch}
              onClick={() => setWebSearch(!webSearch)}
              title="Let the provider search the web for this reply"
            />

            {dictation.supported && (
              <button
                type="button"
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                disabled={dictation.refining || streaming}
                title={
                  dictation.listening
                    ? "Stop dictation and insert the text"
                    : dictationMode === "none"
                      ? "Dictate a message"
                      : `Dictate a message (${dictationMode === "tidy" ? "tidied up" : "fully refined"})`
                }
                aria-label="Dictate a message"
                aria-pressed={dictation.listening}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-60",
                  dictation.listening
                    ? "border-red-500/70 bg-red-950/40 text-red-300"
                    : "border-ink-700 text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
                )}
              >
                {dictation.refining ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden />
                )}
              </button>
            )}

            <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5">
              <ModelSelector />

              {streaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  aria-label="Stop generating"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-700 text-neutral-100 transition hover:bg-ink-600"
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!value.trim() || !hydrated}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-neutral-500"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          </div>
        </div>

        {dictation.listening && (
          <p role="status" className="mt-2 text-center text-[11px] text-neutral-500">
            Listening… tap the microphone to insert what you said.
          </p>
        )}
        {dictation.error && (
          <p role="alert" className="mt-2 text-center text-[11px] text-red-400">
            {dictation.error}
          </p>
        )}

        <p className="mt-2 text-center text-[11px] text-neutral-600">
          Ugnay can make mistakes. Verify important information.
        </p>
      </form>
    </div>
  );
}
