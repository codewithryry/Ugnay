"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Rule {
  key: string;
  amount: number;
  per: "message" | "thousand_tokens" | "claim";
  enabled: boolean;
  cooldown_seconds: number;
  daily_limit: number;
  description: string;
}

interface Task {
  key: string;
  title: string;
  description: string;
  amount: number;
  enabled: boolean;
  repeatable: boolean;
  cooldown_seconds: number;
  daily_limit: number;
}

interface Totals {
  balance: number;
  earned: number;
  spent: number;
  wallets: number;
}

const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const fieldClass =
  "rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-ink-600";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const PER_LABEL: Record<Rule["per"], string> = {
  message: "per message",
  thousand_tokens: "per 1k tokens",
  claim: "per claim",
};

/**
 * Admin → Credits: what the paid features cost, what the rewards pay, and the
 * limits on claiming them. Everything here writes through /api/admin/credits,
 * which re-checks the caller's role; RLS on credit_rules does the same.
 */
export default function AdminCreditsSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  /** 0 means no ceiling on how many credits may be in circulation. */
  const [maxCirculation, setMaxCirculation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/credits", { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load the credit rules.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setRules(data.rules ?? []);
    setTotals(data.totals ?? null);
    setTasks(data.tasks ?? []);
    setMaxCirculation(Number(data.maxCirculation ?? 0));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Same endpoint as a rule; `task: true` picks the tasks table. */
  async function saveTask(key: string, patch: Record<string, unknown>) {
    return saveRule(key, { task: true, ...patch });
  }

  async function saveRule(key: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/admin/credits", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...patch }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not save the change.");
    }
    await load();
    setBusy(false);
  }

  async function saveLimit(next: number) {
    setBusy(true);
    setError(null);
    const res = await apiFetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxCirculation: next }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.error ?? "Could not save the change.");
    await load();
    setBusy(false);
  }

  async function grantCredits() {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await apiFetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, amount: Number(amount) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) setError(body?.error ?? "Could not grant the credits.");
    else {
      setNote(`${nf.format(Number(amount))} credits granted to ${email}.`);
      setEmail("");
      setAmount("");
    }
    await load();
    setBusy(false);
  }

  const spendRules = rules.filter((r) => r.per !== "claim");
  const rewardRules = rules.filter((r) => r.per === "claim");

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-ink-900" aria-busy="true" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs text-danger"
        >
          {error}
        </p>
      )}

      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-neutral-100">Maximum circulation</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
              The most credits that may be held by ordinary accounts at once. Rewards, tasks,
              purchases and admin grants are refused whole once this is reached; spending is
              never blocked. Zero means no limit. Admin wallets are not counted.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
            Limit
            <input
              type="number"
              step="100"
              min="0"
              defaultValue={maxCirculation}
              disabled={busy}
              onBlur={(e) => void saveLimit(Number(e.target.value) || 0)}
              className={cn(fieldClass, "w-32 tabular-nums")}
              aria-label="Maximum credits in circulation"
            />
          </label>
        </div>
        {maxCirculation > 0 && (
          <p className="mt-2 text-[11px] text-neutral-600">
            {nf.format(Math.max(0, maxCirculation - (totals?.balance ?? 0)))} of{" "}
            {nf.format(maxCirculation)} remaining.
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["In circulation", totals?.balance ?? 0],
          ["Maximum", maxCirculation],
          ["Total earned", totals?.earned ?? 0],
          ["Total spent", totals?.spent ?? 0],
        ].map(([label, value]) => (
          <div key={label as string} className={cardClass}>
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-neutral-100">
              {nf.format(Number(value))}
            </p>
          </div>
        ))}
      </div>

      <section className={cn(cardClass, "divide-y divide-ink-800 p-0")}>
        <div className="p-4">
          <h2 className="text-sm font-medium text-neutral-100">What features cost</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Charged from the tokens the provider actually reported. Set an amount to zero, or
            switch a rule off, to make that feature free.
          </p>
        </div>
        {spendRules.map((rule) => (
          <div
            key={rule.key}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <h3 className="text-sm text-neutral-100">
                {rule.description}
                {!rule.enabled && (
                  <span className="ml-2 text-[11px] text-neutral-500">off</span>
                )}
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-600">
                {rule.key} · {PER_LABEL[rule.per]}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input
                type="number"
                step="0.25"
                min="0"
                defaultValue={rule.amount}
                disabled={busy}
                onBlur={(e) => void saveRule(rule.key, { amount: Number(e.target.value) || 0 })}
                className={cn(fieldClass, "w-20 tabular-nums")}
                aria-label={`Cost of ${rule.key}`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveRule(rule.key, { enabled: !rule.enabled })}
                className={cn(
                  "rounded-lg border border-ink-700 px-3 py-1.5 text-xs transition disabled:opacity-60",
                  rule.enabled
                    ? "text-neutral-300 hover:bg-ink-850"
                    : "text-neutral-500 hover:bg-ink-850",
                )}
              >
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className={cn(cardClass, "divide-y divide-ink-800 p-0")}>
        <div className="p-4">
          <h2 className="text-sm font-medium text-neutral-100">Rewards</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Amount granted per claim, the wait between claims, and how many are allowed in the
            period shown. Zero means no limit.
          </p>
        </div>
        {rewardRules.map((rule) => (
          <div
            key={rule.key}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <h3 className="text-sm text-neutral-100">
                {rule.description}
                {!rule.enabled && (
                  <span className="ml-2 text-[11px] text-neutral-500">off</span>
                )}
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-600">{rule.key}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                Credits
                <input
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={rule.amount}
                  disabled={busy}
                  onBlur={(e) => void saveRule(rule.key, { amount: Number(e.target.value) || 0 })}
                  className={cn(fieldClass, "w-20 tabular-nums")}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                Cooldown (s)
                <input
                  type="number"
                  step="60"
                  min="0"
                  defaultValue={rule.cooldown_seconds}
                  disabled={busy}
                  onBlur={(e) =>
                    void saveRule(rule.key, { cooldownSeconds: Number(e.target.value) || 0 })
                  }
                  className={cn(fieldClass, "w-24 tabular-nums")}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                {/* Referrals are capped per month rather than per day, so the
                  * label says which period the number actually governs. */}
                {rule.key === "referral" ? "Per month" : "Per day"}
                <input
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={rule.daily_limit}
                  disabled={busy}
                  onBlur={(e) =>
                    void saveRule(rule.key, { dailyLimit: Number(e.target.value) || 0 })
                  }
                  className={cn(fieldClass, "w-16 tabular-nums")}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveRule(rule.key, { enabled: !rule.enabled })}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 disabled:opacity-60"
              >
                {rule.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className={cn(cardClass, "divide-y divide-ink-800 p-0")}>
        <div className="p-4">
          <h2 className="text-sm font-medium text-neutral-100">Tasks</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            One-off and repeatable things an account can do to earn. Completion is checked
            against their own rows in the database, so a task cannot be claimed by asking.
          </p>
        </div>
        {tasks.map((task) => (
          <div
            key={task.key}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <h3 className="text-sm text-neutral-100">
                {task.title}
                {!task.enabled && <span className="ml-2 text-[11px] text-neutral-500">off</span>}
                {task.repeatable && (
                  <span className="ml-2 text-[11px] text-neutral-500">repeatable</span>
                )}
              </h3>
              <p className="mt-0.5 text-[11px] text-neutral-600">{task.key}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                Credits
                <input
                  type="number"
                  step="5"
                  min="0"
                  defaultValue={task.amount}
                  disabled={busy}
                  onBlur={(e) => void saveTask(task.key, { amount: Number(e.target.value) || 0 })}
                  className={cn(fieldClass, "w-20 tabular-nums")}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                Cooldown (s)
                <input
                  type="number"
                  step="60"
                  min="0"
                  defaultValue={task.cooldown_seconds}
                  disabled={busy}
                  onBlur={(e) =>
                    void saveTask(task.key, { cooldownSeconds: Number(e.target.value) || 0 })
                  }
                  className={cn(fieldClass, "w-24 tabular-nums")}
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                Per day
                <input
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={task.daily_limit}
                  disabled={busy}
                  onBlur={(e) =>
                    void saveTask(task.key, { dailyLimit: Number(e.target.value) || 0 })
                  }
                  className={cn(fieldClass, "w-16 tabular-nums")}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveTask(task.key, { repeatable: !task.repeatable })}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 disabled:opacity-60"
              >
                {task.repeatable ? "Make one-time" : "Make repeatable"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveTask(task.key, { enabled: !task.enabled })}
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-850 disabled:opacity-60"
              >
                {task.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-medium text-neutral-100">Grant credits</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Adds credits to one account and records it in that account&apos;s ledger.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="account@example.com"
            className={cn(fieldClass, "min-w-0 flex-1 py-2.5 text-sm")}
            aria-label="Account email"
          />
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Credits"
            className={cn(fieldClass, "w-full py-2.5 text-sm tabular-nums sm:w-32")}
            aria-label="Credits to grant"
          />
          <button
            type="button"
            disabled={busy || !email.trim() || !(Number(amount) > 0)}
            onClick={() => void grantCredits()}
            className="shrink-0 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
          >
            Grant
          </button>
        </div>
        {note && <p className="mt-2 text-xs text-emerald-400">{note}</p>}
      </section>

      {busy && (
        <p
          role="status"
          className="pointer-events-none fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-ink-700 bg-ink-850/95 px-3 py-1.5 text-xs text-neutral-300 shadow-lg animate-fade-in"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" aria-hidden />
          Saving
        </p>
      )}
    </div>
  );
}
