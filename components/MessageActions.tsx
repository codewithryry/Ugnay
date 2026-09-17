"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  GitBranch,
  Link as LinkIcon,
  MoreHorizontal,
  RefreshCw,
  Loader2,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPORARY_CHAT_ID, useChatStore } from "@/store/chatStore";
import { apiFetch } from "@/lib/api";

type Feedback = "up" | "down" | null;

const buttonClass =
  "flex items-center gap-1.5 rounded-md p-2.5 text-[11px] sm:px-1.5 sm:py-1 text-neutral-500 transition hover:bg-ink-850 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Action bar shown under an assistant response. Copy and Share write to the
 * clipboard; Regenerate calls the handler the parent supplies (omit it and the
 * button is left out). Thumbs ratings persist only while "Improve the model" is
 * enabled in Settings → Data Controls.
 */
export default function MessageActions({
  messageId,
  content,
  shareUrl,
  onRegenerate,
  regenerating = false,
  provider,
  model,
}: {
  messageId: string;
  content: string;
  shareUrl?: string;
  onRegenerate?: () => void;
  regenerating?: boolean;
  /** Which model produced this reply, as stored on the message row. */
  provider?: string | null;
  model?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [speech, setSpeech] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const [linked, setLinked] = useState(false);
  const feedback = useChatStore((s) => s.feedbackByMessage[messageId] ?? null) as Feedback;
  const rateMessage = useChatStore((s) => s.rateMessage);
  const branchFromMessage = useChatStore((s) => s.branchFromMessage);
  // A temporary chat has no stored turns to copy into a branch.
  const canBranch = useChatStore(
    (s) => s.activeChatId !== null && s.activeChatId !== TEMPORARY_CHAT_ID,
  ) && !messageId.startsWith("local-");
  const [branching, setBranching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /**
   * The model that answered, named the way the picker names it. The row stores
   * ids; the catalog is what turns them into labels, and an id the catalog no
   * longer carries (a model that has since been retired) falls back to the id
   * itself rather than showing nothing.
   */
  const catalog = useChatStore((s) => s.catalog);
  const answeredBy = (() => {
    if (!model) return null;
    const entry = catalog.find((p) => p.id === provider);
    const modelLabel = entry?.models.find((m) => m.id === model)?.label ?? model;
    return entry ? `${modelLabel} · ${entry.label}` : modelLabel;
  })();

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      audioRef.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    },
    [],
  );

  function stopSpeech() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrl.current) {
      URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = null;
    }
    setSpeech("idle");
  }

  /** Streams synthesised audio from /api/speech and plays it in the browser. */
  async function readAloud() {
    if (speech !== "idle") {
      stopSpeech();
      return;
    }
    setSpeech("loading");
    try {
      const res = await apiFetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Could not read this message aloud (${res.status}).`);
      }

      const url = URL.createObjectURL(await res.blob());
      audioUrl.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = stopSpeech;
      audio.onerror = stopSpeech;
      await audio.play();
      setSpeech("playing");
    } catch (err) {
      console.error("[ugnay] Read aloud failed:", err);
      stopSpeech();
    }
  }

  function flash(setter: (value: boolean) => void) {
    setter(true);
    timers.current.push(setTimeout(() => setter(false), 1600));
  }

  async function write(text: string, setter: (value: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      flash(setter);
    } catch {
      // Clipboard blocked (insecure context or denied permission).
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="touch-visible -ml-1 mt-2 flex flex-wrap items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 sm:ml-0 sm:gap-1">
      <button
        type="button"
        onClick={() => void write(content, setCopied)}
        title={copied ? "Copied" : "Copy response"}
        aria-label={copied ? "Response copied" : "Copy response"}
        className={buttonClass}
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </button>

      {shareUrl && (
        <button
          type="button"
          onClick={() => void write(shareUrl, setLinked)}
          title={linked ? "Link copied" : "Copy a link to this chat"}
          aria-label={linked ? "Link copied" : "Copy a link to this chat"}
          className={buttonClass}
        >
          {linked ? (
            <Check className="h-4 w-4" aria-hidden />
          ) : (
            <LinkIcon className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}

      <button
        type="button"
        onClick={() => void readAloud()}
        title={speech === "idle" ? "Read aloud" : "Stop reading"}
        aria-label={speech === "idle" ? "Read aloud" : "Stop reading"}
        aria-pressed={speech !== "idle"}
        className={cn(buttonClass, speech !== "idle" && "text-neutral-100")}
      >
        {speech === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : speech === "playing" ? (
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden />
        )}
      </button>

      <button
        type="button"
        onClick={() => void rateMessage(messageId, feedback === "up" ? null : "up")}
        title="Good response"
        aria-label="Good response"
        aria-pressed={feedback === "up"}
        className={cn(buttonClass, feedback === "up" && "text-neutral-100")}
      >
        <ThumbsUp className="h-4 w-4" aria-hidden />
      </button>

      <button
        type="button"
        onClick={() => void rateMessage(messageId, feedback === "down" ? null : "down")}
        title="Bad response"
        aria-label="Bad response"
        aria-pressed={feedback === "down"}
        className={cn(buttonClass, feedback === "down" && "text-neutral-100")}
      >
        <ThumbsDown className="h-4 w-4" aria-hidden />
      </button>

      {canBranch && (
        <button
          type="button"
          onClick={async () => {
            setBranching(true);
            await branchFromMessage(messageId);
            setBranching(false);
          }}
          disabled={branching}
          title="Branch a new conversation from here"
          aria-label="Branch a new conversation from here"
          className={buttonClass}
        >
          {branching ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <GitBranch className="h-4 w-4" aria-hidden />
          )}
        </button>
      )}

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          title="Regenerate response"
          aria-label="Regenerate response"
          className={buttonClass}
        >
          <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} aria-hidden />
        </button>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="More options"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={buttonClass}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" aria-hidden onClick={() => setMenuOpen(false)} />
            <div
              role="menu"
              aria-label="Message options"
              className="absolute bottom-[calc(100%+0.35rem)] left-0 z-20 w-[min(14rem,calc(100vw-2rem))] rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-2xl animate-fade-in"
            >
              {/* Which model produced this reply. Read-only, so it is a header
                * rather than a menu item. */}
              {answeredBy && (
                <>
                  <div className="px-2.5 pb-1.5 pt-1.5">
                    <p className="mt-1 break-words text-sm leading-snug text-neutral-200">
                      {answeredBy}
                    </p>
                  </div>
                  {(shareUrl || onRegenerate) && (
                    <div className="my-1 h-px bg-ink-700" role="none" />
                  )}
                </>
              )}

              {shareUrl && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void write(shareUrl, setLinked);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-200 transition hover:bg-ink-800"
                >
                  <LinkIcon className="h-4 w-4 text-neutral-500" aria-hidden />
                  Copy chat link
                </button>
              )}

              {onRegenerate && (
                <button
                  role="menuitem"
                  type="button"
                  disabled={regenerating}
                  onClick={() => {
                    setMenuOpen(false);
                    onRegenerate();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-200 transition hover:bg-ink-800 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4 text-neutral-500" aria-hidden />
                  Regenerate response
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
