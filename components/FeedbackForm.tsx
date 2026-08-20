"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/** Matches the kinds the API and the table's check constraint accept. */
const KINDS: { id: "idea" | "bug" | "other"; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "bug", label: "Bug" },
  { id: "other", label: "Other" },
];
const MESSAGE_LIMIT = 4000;

export default function FeedbackForm() {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = message.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Could not send your feedback.");
      setSent(true);
      setMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-ink-800 bg-ink-900 p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm text-neutral-100">
          <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          Thanks — your feedback was sent.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          We read everything that comes in, even when we cannot reply to it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSent(false)}
            className="rounded-xl border border-ink-700 px-3 py-2 text-xs text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            Send more feedback
          </button>
          <Link
            href="/"
            className="rounded-xl bg-neutral-100 px-3 py-2 text-xs font-medium text-ink-950 transition hover:bg-white"
          >
            Back to Ugnay
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink-800 bg-ink-900 p-4 sm:p-6">
      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          What is this about?
        </legend>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setKind(option.id)}
              aria-pressed={kind === option.id}
              className={cn(
                "rounded-xl border px-3.5 py-2 text-sm transition",
                kind === option.id
                  ? "border-neutral-500 bg-ink-800 text-neutral-100"
                  : "border-ink-700 text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label
        htmlFor="feedback-message"
        className="mt-6 block text-xs font-medium uppercase tracking-wide text-neutral-500"
      >
        Your feedback
      </label>
      <textarea
        id="feedback-message"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_LIMIT))}
        rows={7}
        required
        placeholder={
          kind === "bug"
            ? "What did you do, what did you expect, and what happened instead?"
            : "Tell us what would make Ugnay better for you."
        }
        className="mt-2.5 w-full resize-y rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[11px] text-neutral-600">
          Sent with your account so we can follow up.
        </p>
        <p className="shrink-0 text-[11px] text-neutral-600">
          {message.length} / {MESSAGE_LIMIT}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-rose-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={sending || !message.trim()}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 px-3 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        <Send className="h-3.5 w-3.5" aria-hidden />
        {sending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
