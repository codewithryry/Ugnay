"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import Modal from "./Modal";

/**
 * What the visitor picks, and the `kind` each one is stored as. The table's
 * check constraint accepts idea/bug/other, so the finer labels map onto those
 * three rather than needing a migration.
 */
const REPORT_TYPES: { id: string; label: string; kind: "idea" | "bug" | "other" }[] = [
  { id: "general", label: "General feedback", kind: "other" },
  { id: "bug", label: "Report issue / bug", kind: "bug" },
  { id: "feature", label: "Feature request", kind: "idea" },
  { id: "response", label: "Response feedback", kind: "other" },
  { id: "other", label: "Something else", kind: "other" },
];
/** Matches the limit the API and the table enforce. */
const MESSAGE_LIMIT = 4000;

export default function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState("");
  const [type, setType] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts clean, so a previous submission is never resent or
  // left on screen.
  useEffect(() => {
    if (open) return;
    setMessage("");
    setType("");
    setSending(false);
    setSent(false);
    setError(null);
  }, [open]);

  async function send() {
    const body = message.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      // No selection is still valid feedback; it is filed as "other".
      const kind = REPORT_TYPES.find((t) => t.id === type)?.kind ?? "other";
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, message: body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Could not send your feedback.");
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const footer = sent ? (
    <>
      <button
        type="button"
        onClick={() => {
          setSent(false);
          setMessage("");
          setType("");
        }}
        className="rounded-xl border border-ink-700 px-3.5 py-2 text-sm text-neutral-300 transition hover:bg-ink-850 hover:text-neutral-100"
      >
        Send more
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90"
      >
        Done
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={send}
      disabled={sending || !message.trim()}
      className="rounded-xl bg-neutral-100 px-5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {sending ? "Sending…" : "Send"}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title="Feedback" footer={footer}>
      {sent ? (
        <div className="py-6">
          <p className="flex items-center gap-2 text-sm text-neutral-100">
            <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
            Thanks — your feedback was sent.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">
            We read everything that comes in, even when we cannot reply to it.
          </p>
        </div>
      ) : (
        <>
          <label htmlFor="feedback-message" className="sr-only">
            Your feedback
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_LIMIT))}
            rows={8}
            placeholder="Give us your feedback"
            className="w-full resize-y rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm"
          />

          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="text-[11px] text-neutral-600">
              Sent with your account so we can follow up.
            </p>
            <p className="shrink-0 text-[11px] text-neutral-600">
              {message.length} / {MESSAGE_LIMIT}
            </p>
          </div>

          <div className="mt-5">
            <label
              htmlFor="feedback-type"
              className="mb-1.5 block text-sm font-medium text-neutral-200"
            >
              Feedback type <span className="text-neutral-500">(optional)</span>
            </label>
            <select
              id="feedback-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-neutral-100 focus:border-ink-600 sm:text-sm"
            >
              <option value="">Select report type</option>
              {REPORT_TYPES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-xs leading-relaxed text-rose-400">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
