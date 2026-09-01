"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Copy, Gift, Loader2, Share2, X } from "lucide-react";
import Modal from "./Modal";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";

interface Referral {
  id: string;
  status: "pending" | "qualified" | "rejected";
  amount: number;
  created_at: string;
  qualified_at: string | null;
  reason: string | null;
}

interface Summary {
  code: string | null;
  enabled: boolean;
  reward: number;
  welcome: number;
  monthlyLimit: number;
  monthlyCount: number;
  successful: number;
  pending: number;
  earned: number;
  history: Referral[];
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Short, so a history row stays on one line: "3 Sep, 14:02". */
function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-neutral-100">{value}</p>
    </div>
  );
}

/** A quiet heading, matching the credits modal rather than boxing every group. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
      {children}
    </h3>
  );
}

/** What each referral state means to the person who invited someone. */
const STATUS: Record<Referral["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "text-amber-400" },
  qualified: { label: "Earned", tone: "text-emerald-400" },
  rejected: { label: "Not counted", tone: "text-neutral-500" },
};

/**
 * Invite & Earn: the account's own invite code, what it has earned, and the
 * referrals behind that figure.
 *
 * Nothing in this file can move a balance. Copying or sharing the link is a
 * clipboard call and nothing more — the referrer is paid only after the
 * invited account has done the qualifying action, which is checked in the
 * database against that account's own rows. The counts and the history come
 * from /api/credits/referrals; none of them are computed here.
 *
 * Referrals are keyed to the persistent identity hash rather than the account
 * id, so a self-referral, a second code, or deleting and recreating an account
 * to be invited again are all refused server-side.
 */
export default function ReferralModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [creating, setCreating] = useState(false);
  const refreshCredits = useChatStore((s) => s.refreshCredits);

  const load = useCallback(async () => {
    const res = await fetch("/api/credits/referrals", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not load your invites.");
      setLoading(false);
      return;
    }
    setData(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setNote(null);
    void load();
  }, [open, load]);

  /**
   * Asks the server to mint this account's invite code.
   *
   * Deliberately a write request the person triggers: reading the modal must
   * not create anything, so the code appears when they ask to share rather
   * than as a side effect of looking. Settling any referral this account owes
   * rides along on the same write.
   */
  async function createCode() {
    setCreating(true);
    setError(null);
    const res = await fetch("/api/credits/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "code" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      setError(body?.error ?? "Could not create your invite code.");
    } else {
      await load();
      await refreshCredits();
    }
    setCreating(false);
  }

  /** The link an invited person opens. Built from the code, never from the id. */
  const link =
    data?.code && typeof window !== "undefined"
      ? `${window.location.origin}/login?invite=${data.code}`
      : "";

  /** Copying is a clipboard call and nothing else — no credit is involved. */
  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the link.");
    }
  }

  /** The native share sheet where there is one, falling back to a copy. */
  async function shareLink() {
    if (!link) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "Ugnay",
          text: "Try Ugnay with my invite code",
          url: link,
        });
        return;
      } catch {
        // Dismissing the sheet is not an error worth reporting.
        return;
      }
    }
    await copyLink();
  }

  /** Redeems someone else's code. The server decides; this only asks. */
  async function redeem() {
    if (!code.trim()) return;
    setRedeeming(true);
    setError(null);
    setNote(null);
    const res = await fetch("/api/credits/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept", code: code.trim() }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      setError(body?.error ?? body?.reason ?? "Could not use that code.");
    } else {
      setNote(
        Number(body.welcome) > 0
          ? `Invite accepted — ${nf.format(Number(body.welcome))} credits added.`
          : "Invite accepted.",
      );
      setCode("");
      await load();
      await refreshCredits();
    }
    setRedeeming(false);
  }

  const limit = data?.monthlyLimit ?? 0;
  const used = data?.monthlyCount ?? 0;
  const progress = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite & Earn"
      description="Share Ugnay and earn credits when the people you invite start using it."
    >
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]" aria-busy="true">
          <div className="h-56 animate-pulse rounded-xl bg-ink-850" />
          <div className="h-56 animate-pulse rounded-xl bg-ink-850" />
        </div>
      ) : error && !data ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        <>
          {note && <p className="mb-3 text-xs text-emerald-400">{note}</p>}
          {error && data && (
            <p role="alert" className="mb-3 text-xs text-danger">
              {error}
            </p>
          )}

          {!data?.enabled && (
            <p className="mb-3 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
              Invites are paused at the moment, so a new referral will not earn credits. Your code
              and history are unchanged.
            </p>
          )}

          {/* Same two-column shape as the credits modal: the wide column
            * carries the code and the explanation, the narrow one the history. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] lg:items-start">
            {/* --------------------------------- left: the code and the stats */}
            <div className="order-1 min-w-0 space-y-4">
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3.5">
                <div className="flex items-center gap-3">
                  <Gift className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                      Your invite code
                    </p>
                    <p
                      className={cn(
                        "font-display text-2xl font-semibold leading-tight tracking-wide",
                        data?.code ? "text-neutral-100" : "text-neutral-600",
                      )}
                    >
                      {data?.code ?? "Not created yet"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {data?.code ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void copyLink()}
                          className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:opacity-90"
                        >
                          {copied ? (
                            <Check className="h-3 w-3" aria-hidden />
                          ) : (
                            <Copy className="h-3 w-3" aria-hidden />
                          )}
                          {copied ? "Copied" : "Copy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void shareLink()}
                          className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800"
                        >
                          <Share2 className="h-3 w-3" aria-hidden />
                          Share
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={creating}
                        onClick={() => void createCode()}
                        className="flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                      >
                        {creating && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                        Get my code
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 items-start justify-items-center gap-3 border-t border-ink-800 pt-3">
                  <Stat label="Joined" value={nf.format(data?.successful ?? 0)} />
                  <Stat label="Earned" value={nf.format(data?.earned ?? 0)} />
                  <Stat label="Waiting" value={nf.format(data?.pending ?? 0)} />
                </div>

                {limit > 0 && (
                  <div className="mt-3 border-t border-ink-800 pt-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-500">This month</span>
                      <span className="tabular-nums text-neutral-400">
                        {nf.format(used)} of {nf.format(limit)}
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800"
                      role="progressbar"
                      aria-valuenow={used}
                      aria-valuemin={0}
                      aria-valuemax={limit}
                      aria-label="Referrals this month"
                    >
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          used >= limit ? "bg-amber-400" : "bg-accent",
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {used >= limit && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-amber-400">
                        You have reached this month&apos;s invite limit. It resets at the start of
                        next month.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <SectionTitle>How it works</SectionTitle>
                <ol className="space-y-1.5 text-[11px] leading-relaxed text-neutral-400">
                  <li className="flex gap-2">
                    <span className="text-neutral-600">1.</span>
                    Share your code or link with someone who has not used Ugnay.
                  </li>
                  <li className="flex gap-2">
                    <span className="text-neutral-600">2.</span>
                    They sign up and enter your code.
                    {(data?.welcome ?? 0) > 0 &&
                      ` They get ${nf.format(data?.welcome ?? 0)} credits for joining.`}
                  </li>
                  <li className="flex gap-2">
                    <span className="text-neutral-600">3.</span>
                    Once they have held a real conversation, you earn{" "}
                    {nf.format(data?.reward ?? 0)} credits.
                  </li>
                </ol>
                <p className="text-[11px] leading-relaxed text-neutral-600">
                  Sharing or copying your link never earns credits on its own, and you cannot
                  invite yourself — including from a new account.
                </p>
              </div>

              {/* Redeeming someone else's code. Only offered while the account
                * has not already used one, which the server enforces anyway. */}
              <div className="space-y-2">
                <SectionTitle>Have an invite code?</SectionTitle>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="Enter a code"
                    aria-label="Invite code"
                    maxLength={16}
                    className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-xs uppercase tracking-wide text-neutral-100 placeholder:normal-case placeholder:tracking-normal placeholder:text-neutral-600 focus:border-ink-600"
                  />
                  <button
                    type="button"
                    disabled={redeeming || !code.trim()}
                    onClick={() => void redeem()}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-xs text-neutral-200 transition hover:bg-ink-800 disabled:opacity-50"
                  >
                    {redeeming && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    Use code
                  </button>
                </div>
              </div>
            </div>

            {/* ------------------------------------- right: the history panel */}
            <div className="order-2 min-w-0 space-y-2 lg:row-span-2">
              <SectionTitle>Your invites</SectionTitle>
              {data?.history.length ? (
                <ul className="space-y-1.5">
                  {data.history.map((row) => {
                    const state = STATUS[row.status];
                    return (
                      <li
                        key={row.id}
                        className="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn("flex items-center gap-1.5 text-[11px]", state.tone)}
                          >
                            {row.status === "qualified" ? (
                              <Check className="h-3 w-3" aria-hidden />
                            ) : row.status === "rejected" ? (
                              <X className="h-3 w-3" aria-hidden />
                            ) : (
                              <Clock className="h-3 w-3" aria-hidden />
                            )}
                            {state.label}
                          </span>
                          {row.status === "qualified" && (
                            <span className="shrink-0 text-[11px] font-medium tabular-nums text-emerald-400">
                              +{nf.format(row.amount)}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-neutral-600">
                          {when(row.qualified_at ?? row.created_at)}
                        </p>
                        {row.reason && (
                          <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-500">
                            {row.reason}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[11px] leading-relaxed text-neutral-600">
                  No invites yet. Share your code to get started — you will see each person here
                  as they join.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
