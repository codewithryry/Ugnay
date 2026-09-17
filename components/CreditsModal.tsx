"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Coins, Loader2, PlayCircle } from "lucide-react";
import Modal from "./Modal";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chatStore";
import { apiFetch } from "@/lib/api";

interface Transaction {
  id: string;
  amount: number;
  kind: "spend" | "earn";
  reason: string;
  balance_after: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Rule {
  key: string;
  amount: number;
  per: "message" | "thousand_tokens" | "claim";
  description: string;
}

interface Task {
  key: string;
  title: string;
  description: string;
  amount: number;
  repeatable: boolean;
  actionHref: string | null;
  /** Ugnay can see the account has done it. Never asserted by this file. */
  done: boolean;
  claimed: boolean;
}

interface WalletPayload {
  wallet: {
    balance: number;
    totalEarned: number;
    totalSpent: number;
    streakDays: number;
    dailyClaimed: boolean;
  };
  transactions: Transaction[];
  rules: Rule[];
  rewardedAds: boolean;
  /** Admins are exempt from charges; decided on the server, shown here. */
  unlimited?: boolean;
}

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Ledger reasons, in the words the account would use. */
const REASONS: Record<string, string> = {
  chat: "AI chat",
  web_search: "Web search",
  knowledge: "Knowledge recall",
  memory: "Personalisation",
  speech: "Read aloud",
  daily_login: "Daily credits",
  streak: "Streak bonus",
  rewarded_ad: "Rewarded ad",
  streak_7: "7-day streak",
  streak_30: "30-day streak",
  signup: "Welcome bonus",
  purchase: "Credits purchased",
  admin_grant: "Granted by Ugnay",
  admin_adjustment: "Admin adjustment",
  referral: "Invite reward",
  referral_welcome: "Invite bonus",
};

/** Short, so an activity row stays on one line: "3 Sep, 14:02". */
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

/** A quiet heading, used instead of wrapping every group in its own card. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
      {children}
    </h3>
  );
}

/**
 * The credit wallet: what is left, how to earn more, where it goes, and what
 * has happened lately.
 *
 * Two columns on a desktop: a wide left column carrying the balance and the
 * ways to earn, and a narrower panel beside it for recent activity — so the
 * whole thing fits in about half the height it used to need.
 * Everything shown is read from /api/credits; the balance is never computed
 * here, and no button in this file can move it. Claiming calls the server,
 * which decides whether the claim is allowed.
 */
export default function CreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<WalletPayload | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [claimingTask, setClaimingTask] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const setCredits = useChatStore((s) => s.refreshCredits);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch("/api/credits", { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load your credits.");
      setLoading(false);
      return;
    }
    setData(await res.json());

    const tasksRes = await apiFetch("/api/credits/tasks", { cache: "no-store" });
    setTasks(tasksRes.ok ? ((await tasksRes.json()).tasks ?? []) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void load();
  }, [open, load]);

  async function claimDaily() {
    setClaiming(true);
    setError(null);
    setNote(null);
    const res = await apiFetch("/api/credits/claim", { method: "POST" });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? "Could not claim your credits.");
    } else if (body?.claimed) {
      const milestone = typeof body.milestone === "string" ? body.milestone : null;
      setNote(
        `${nf.format(Number(body.granted))} credits added.` +
          (milestone ? ` ${REASONS[milestone] ?? milestone} reached.` : ""),
      );
    } else {
      setNote("You have already claimed today. Come back tomorrow.");
    }
    await load();
    await setCredits();
    setClaiming(false);
  }

  async function claimTask(key: string) {
    setClaimingTask(key);
    setError(null);
    setNote(null);
    const res = await apiFetch("/api/credits/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.error ?? "Could not claim that task.");
    else if (body?.claimed) setNote(`${nf.format(Number(body.granted))} credits added.`);
    else setError(body?.reason ?? "That task cannot be claimed yet.");
    await load();
    await setCredits();
    setClaimingTask(null);
  }

  const wallet = data?.wallet;
  const spendRules = data?.rules.filter((r) => r.per !== "claim") ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ugnay Credits"
      description="Your balance, how to earn more, and where credits go."
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

          {/* Left is the main content and stays wider; the activity panel beside
            * it is deliberately narrower. On a phone both simply stack in the
            * reading order: balance, earning, activity, spending. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)] lg:items-start">
            {/* ------------------------------------- left: the main column */}
            <div className="order-1 min-w-0 space-y-4">
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3.5">
                <div className="flex items-center gap-3">
                  <Coins className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">Balance</p>
                    <p className="font-display text-2xl font-semibold leading-tight tabular-nums text-neutral-100">
                      {data?.unlimited ? "Unlimited" : nf.format(wallet?.balance ?? 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void claimDaily()}
                    disabled={claiming || wallet?.dailyClaimed}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50",
                      wallet?.dailyClaimed
                        ? "border border-ink-700 text-neutral-400"
                        : "bg-neutral-100 text-ink-950 hover:opacity-90",
                    )}
                  >
                    {claiming && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    {wallet?.dailyClaimed ? "Claimed" : "Claim daily"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 items-start justify-items-center gap-3 border-t border-ink-800 pt-3">
                  <Stat label="Earned" value={nf.format(wallet?.totalEarned ?? 0)} />
                  <Stat label="Spent" value={nf.format(wallet?.totalSpent ?? 0)} />
                  <Stat label="Streak" value={`${wallet?.streakDays ?? 0}d`} />
                </div>

                {!data?.unlimited && (wallet?.balance ?? 0) <= 0 && (
                  <p className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-[11px] leading-relaxed text-danger">
                    You are out of credits. Claim your daily credits, finish a task, or buy more.
                  </p>
                )}
                {data?.unlimited && (
                  <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
                    Your admin account is not charged for AI usage.
                  </p>
                )}
              </div>

              {tasks?.length ? (
                <div>
                  <SectionTitle>How you earn</SectionTitle>
                  <ul className="mt-1.5 divide-y divide-ink-800/70">
                    {tasks.map((task) => (
                      <li key={task.key} className="flex items-center gap-2.5 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">
                          {task.title}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-emerald-400">
                          +{nf.format(task.amount)}
                        </span>
                        {task.claimed ? (
                          <span
                            title={task.repeatable ? "Claimed today" : "Claimed"}
                            className="flex shrink-0 items-center text-neutral-600"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </span>
                        ) : task.done ? (
                          <button
                            type="button"
                            disabled={claimingTask !== null}
                            onClick={() => void claimTask(task.key)}
                            className="flex shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-[10px] font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                          >
                            {claimingTask === task.key && (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
                            )}
                            Claim
                          </button>
                        ) : task.actionHref ? (
                          <Link
                            href={task.actionHref}
                            onClick={onClose}
                            className="shrink-0 rounded-md border border-ink-700 px-2 py-1 text-[10px] text-neutral-300 transition hover:bg-ink-850"
                          >
                            Go
                          </Link>
                        ) : (
                          <span className="shrink-0 text-[10px] text-neutral-600">Not yet</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* -------------------------- right: the secondary panel */}
            <div className="order-3 min-w-0 lg:order-2 lg:row-span-2">
              <SectionTitle>Recent activity</SectionTitle>
              {data?.transactions.length ? (
                <ul className="mt-1.5 max-h-56 divide-y divide-ink-800/70 overflow-y-auto overscroll-contain pr-0.5 lg:max-h-[21rem]">
                  {data.transactions.map((t) => (
                    <li key={t.id} className="flex items-center gap-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-neutral-200">
                          {REASONS[t.reason] ??
                            (t.reason.startsWith("task:")
                              ? (tasks?.find((task) => task.key === t.reason.slice(5))?.title ??
                                "Task reward")
                              : t.reason)}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-neutral-600">
                          {when(t.created_at)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          t.kind === "earn" ? "text-emerald-400" : "text-neutral-400",
                        )}
                      >
                        {t.kind === "earn" ? "+" : ""}
                        {nf.format(t.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">
                  Nothing yet. Credits you earn and spend will be listed here.
                </p>
              )}
            </div>

            {/* Where credits go: the bottom of the left column, and last of
              * all on a phone. Prose rather than another list of cards. */}
            <div className="order-4 min-w-0 lg:col-start-1 lg:row-start-2">
              <SectionTitle>Where credits go</SectionTitle>
              <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
                {spendRules.length ? (
                  <>
                    Replies are charged from the tokens a model actually reported, with extras
                    added per message:{" "}
                    <span className="text-neutral-400">
                      {spendRules
                        .map((r) => `${REASONS[r.key] ?? r.key} ${nf.format(r.amount)}`)
                        .join(" · ")}
                    </span>
                    . A longer answer costs more than a short one.
                  </>
                ) : (
                  "Nothing costs credits at the moment."
                )}
              </p>
              {data?.rewardedAds && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-neutral-500">
                  <PlayCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  Rewarded ads add credits once the ad network confirms the view.
                </p>
              )}
              {!data?.unlimited && (
                <Link
                  href="/credits"
                  onClick={onClose}
                  className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2 text-xs text-neutral-200 transition hover:border-ink-700 hover:bg-ink-850"
                >
                  Buy more credits
                  <span className="text-[10px] text-neutral-500">PayPal or GCash</span>
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
