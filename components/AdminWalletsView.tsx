"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import Modal from "./Modal";
import { cn } from "@/lib/utils";

interface WalletRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  streak_days: number;
  updated_at: string;
  /** True for the signed-in admin's own wallet, which may not be wiped here. */
  is_self?: boolean;
}

interface Totals {
  wallets: number;
  active: number;
  balance: number;
  earned: number;
  spent: number;
}

interface Transaction {
  id: string;
  amount: number;
  kind: "spend" | "earn";
  reason: string;
  balance_after: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const fieldClass =
  "rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** Ledger reasons, in the words an admin would use. */
const REASONS: Record<string, string> = {
  chat: "AI chat",
  web_search: "Web search",
  knowledge: "Knowledge recall",
  memory: "Personalisation",
  speech: "Read aloud",
  daily_login: "Daily credits",
  streak: "Streak bonus",
  streak_7: "7-day streak",
  streak_30: "30-day streak",
  rewarded_ad: "Rewarded ad",
  signup: "Welcome bonus",
  purchase: "Credits purchased",
  admin_grant: "Admin grant",
  admin_adjustment: "Admin adjustment",
};

function reasonLabel(reason: string) {
  if (REASONS[reason]) return REASONS[reason];
  if (reason.startsWith("task:")) return `Task: ${reason.slice(5)}`;
  return reason;
}

/**
 * Admin → Wallets: what is in circulation, and every account's balance.
 *
 * Everything is read through security-definer functions that re-check the
 * caller's role in the database. Granting posts to /api/admin/wallets, which
 * calls grant_credits() — the only path that may move a balance, and the one
 * that writes the wallet and the append-only ledger in one transaction. This
 * file never edits a balance itself.
 */
export default function AdminWalletsSection() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [admins, setAdmins] = useState(0);
  /** The ceiling the database enforces, and what is left of it. */
  const [maxCirculation, setMaxCirculation] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** The wallet whose drawer is open, if any. */
  const [open, setOpen] = useState<WalletRow | null>(null);
  const [history, setHistory] = useState<Transaction[] | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [granting, setGranting] = useState(false);
  /** The wallet a deletion has been asked for, held until it is confirmed. */
  const [confirming, setConfirming] = useState<WalletRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (search: string) => {
    const url = search.trim()
      ? `/api/admin/wallets?q=${encodeURIComponent(search.trim())}`
      : "/api/admin/wallets";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load the wallets.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setWallets(
      (data.wallets ?? []).map((w: WalletRow) => ({
        ...w,
        balance: Number(w.balance),
        total_earned: Number(w.total_earned),
        total_spent: Number(w.total_spent),
      })),
    );
    setTotals(
      data.totals
        ? {
            wallets: Number(data.totals.wallets),
            active: Number(data.totals.active),
            balance: Number(data.totals.balance),
            earned: Number(data.totals.earned),
            spent: Number(data.totals.spent),
          }
        : null,
    );
    setAdmins(Number(data.admins ?? 0));
    setMaxCirculation(Number(data.maxCirculation ?? 0));
    setRemaining(
      data.remaining === null || data.remaining === undefined ? null : Number(data.remaining),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Typing filters after a short pause, so a search is one request not ten.
  useEffect(() => {
    const timer = setTimeout(() => void load(query), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  async function openWallet(row: WalletRow) {
    setOpen(row);
    setHistory(null);
    setAmount("");
    setReason("");
    setError(null);
    const res = await fetch(`/api/admin/wallets?user=${row.user_id}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load that wallet.");
      return;
    }
    const data = await res.json();
    setHistory(
      (data.transactions ?? []).map((t: Transaction) => ({ ...t, amount: Number(t.amount) })),
    );
  }

  /** Both directions go through the same admin endpoint and the same ledger. */
  async function adjust(action: "grant" | "remove") {
    if (!open) return;
    setGranting(true);
    setError(null);
    setNote(null);
    const res = await fetch("/api/admin/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId: open.user_id, amount: Number(amount), note: reason }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      setError(body?.error ?? "Could not adjust that wallet.");
    } else {
      setNote(
        action === "grant"
          ? `${nf.format(Number(amount))} credits granted to ${open.email ?? "that account"}.`
          : `${nf.format(Number(amount))} credits removed from ${open.email ?? "that account"}.`,
      );
      setAmount("");
      setReason("");
      await openWallet(open);
      await load(query);
    }
    setGranting(false);
  }

  /**
   * Wipes one account's application data. The confirmation above is a
   * courtesy; the refusals that matter — own account, another admin — are in
   * the database function this calls.
   */
  async function deleteData() {
    if (!confirming) return;
    setDeleting(true);
    setError(null);
    setNote(null);
    const res = await fetch("/api/admin/wallets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: confirming.user_id }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      setError(body?.error ?? "Could not delete that data.");
    } else {
      const removed = body.removed ?? {};
      setNote(
        `Deleted ${nf.format(Number(removed.chats ?? 0))} conversations, ` +
          `${nf.format(Number(removed.messages ?? 0))} messages, ` +
          `${nf.format(Number(removed.files ?? 0))} files and ` +
          `${nf.format(Number(removed.transactions ?? 0))} ledger entries from ` +
          `${confirming.email ?? "that account"}.`,
      );
      setConfirming(null);
      // The wallet is gone, so the drawer and the list must forget it too.
      if (open?.user_id === confirming.user_id) setOpen(null);
      await load(query);
    }
    setDeleting(false);
  }

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
      {note && <p className="text-xs text-emerald-400">{note}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["In circulation", totals?.balance ?? 0, null],
            ["Maximum circulation", maxCirculation, maxCirculation > 0 ? null : "No limit set"],
            [
              "Remaining capacity",
              remaining ?? 0,
              remaining === null ? "No limit set" : remaining <= 0 ? "Supply limit reached" : null,
            ],
            ["Active wallets", totals?.active ?? 0, null],
          ] as Array<[string, number, string | null]>
        ).map(([label, value, hint]) => (
          <div key={label} className={cardClass}>
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-neutral-100">
              {hint === "No limit set" ? "\u2014" : nf.format(value)}
            </p>
            {hint && (
              <p
                className={cn(
                  "mt-1 text-[11px]",
                  hint === "Supply limit reached" ? "text-amber-400" : "text-neutral-600",
                )}
              >
                {hint}
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-neutral-600">
        Circulation counts ordinary accounts only — {totals?.wallets ?? 0} of them.{" "}
        {admins > 0 && `${admins} admin ${admins === 1 ? "wallet is" : "wallets are"} excluded: `}
        admins are not charged for AI usage, so their balances are not credits in circulation.
      </p>

      <section className={cn(cardClass, "p-0")}>
        <div className="flex items-center gap-2 border-b border-ink-800 p-4">
          <Search className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or name"
            aria-label="Search wallets"
            className={cn(fieldClass, "min-w-0 flex-1 border-0 bg-transparent px-0 py-0 focus:border-0")}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="shrink-0 rounded p-1 text-neutral-500 transition hover:text-neutral-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {wallets.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                  <th className="px-4 py-2 text-right font-medium">Earned</th>
                  <th className="px-4 py-2 text-right font-medium">Spent</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="text-neutral-300">
                {wallets.map((w) => (
                  <tr key={w.user_id} className="border-t border-ink-800">
                    <td className="max-w-[16rem] truncate px-4 py-2.5">
                      <span className="text-neutral-100">
                        {w.display_name || w.email || "Account"}
                      </span>
                      {w.display_name && w.email && (
                        <span className="ml-2 text-neutral-600">{w.email}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-100">
                      {nf.format(w.balance)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {nf.format(w.total_earned)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {nf.format(w.total_spent)}
                    </td>
                    <td className="px-4 py-2.5">
                      {w.role === "admin" ? (
                        <span className="text-amber-400">Unlimited</span>
                      ) : w.balance > 0 ? (
                        <span className="text-emerald-400">Active</span>
                      ) : (
                        <span className="text-neutral-500">Empty</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void openWallet(w)}
                        className="rounded-lg border border-ink-700 px-2.5 py-1 text-[11px] text-neutral-300 transition hover:bg-ink-850"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-4 text-xs leading-relaxed text-neutral-600">
            No wallets match that search.
          </p>
        )}
      </section>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.display_name || open?.email || "Wallet"}
        description="Balance, recent ledger, and granting credits."
      >
        {open && (
          <>
            <div className="grid grid-cols-3 items-start justify-items-center gap-3 rounded-xl border border-ink-800 bg-ink-950 p-3.5">
              {[
                ["Balance", open.balance],
                ["Earned", open.total_earned],
                ["Spent", open.total_spent],
              ].map(([label, value]) => (
                <div key={label as string} className="min-w-0 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
                  <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-neutral-100">
                    {nf.format(Number(value))}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                Adjust credits
              </h3>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Credits"
                  aria-label="Credits to grant"
                  className={cn(fieldClass, "w-full tabular-nums sm:w-28")}
                />
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (required)"
                  aria-label="Reason for the grant"
                  className={cn(fieldClass, "min-w-0 flex-1")}
                />
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={granting || !(Number(amount) > 0) || !reason.trim()}
                    onClick={() => void adjust("grant")}
                    className="flex items-center justify-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                  >
                    {granting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    Grant
                  </button>
                  <button
                    type="button"
                    disabled={
                      granting ||
                      !(Number(amount) > 0) ||
                      !reason.trim() ||
                      Number(amount) > open.balance
                    }
                    title={
                      Number(amount) > open.balance
                        ? "That is more than this wallet holds"
                        : undefined
                    }
                    onClick={() => void adjust("remove")}
                    className="rounded-lg border border-danger/30 px-3.5 py-2 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">
                Recorded on this account&apos;s ledger with the reason above — a grant, or an
                admin adjustment when removing. Nothing already on the ledger is changed, and a
                grant is refused whole if it would take circulation past the maximum.
              </p>

            {!open.is_self && open.role !== "admin" && (
              <div className="mt-4 rounded-xl border border-danger/25 bg-danger-soft p-3.5">
                <h3 className="text-xs font-medium text-danger">Delete application data</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-danger/80">
                  Removes this account&apos;s conversations, workspaces, Knowledge, prompts,
                  workflows, feedback, wallet and credit history. The sign-in itself is kept, as
                  is the record that stops rewards being claimed twice.
                </p>
                <button
                  type="button"
                  onClick={() => setConfirming(open)}
                  className="mt-2.5 rounded-lg border border-danger/30 px-3 py-1.5 text-[11px] font-medium text-danger transition hover:bg-danger/10"
                >
                  Delete data…
                </button>
              </div>
            )}
            </div>

            <h3 className="mt-4 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Recent ledger
            </h3>
            {history === null ? (
              <div className="mt-1.5 h-32 animate-pulse rounded-xl bg-ink-850" aria-busy="true" />
            ) : history.length ? (
              <ul className="mt-1.5 max-h-64 divide-y divide-ink-800/70 overflow-y-auto overscroll-contain">
                {history.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-neutral-200">
                        {reasonLabel(t.reason)}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-neutral-600">
                        {new Date(t.created_at).toLocaleString()}
                        {typeof t.metadata?.note === "string" && t.metadata.note
                          ? ` · ${t.metadata.note}`
                          : ""}
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
                Nothing on this ledger yet.
              </p>
            )}
          </>
        )}
      </Modal>

      <Modal
        open={confirming !== null}
        onClose={() => (deleting ? undefined : setConfirming(null))}
        title="Delete this account's data?"
        description="This cannot be undone."
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={deleting}
              className="rounded-lg px-3.5 py-2 text-sm text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void deleteData()}
              disabled={deleting}
              className="flex items-center gap-2 rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-60"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Delete data
            </button>
          </>
        }
      >
        {confirming && (
          <>
            <p className="text-sm leading-relaxed text-neutral-300">
              Everything{" "}
              <span className="text-neutral-100">
                {confirming.display_name || confirming.email || "this account"}
              </span>{" "}
              has made in Ugnay will be permanently removed:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-neutral-400">
              <li>• All conversations and messages</li>
              <li>• Workspaces, prompts and workflows</li>
              <li>• Knowledge files and everything indexed from them</li>
              <li>• Share links and feedback</li>
              <li>
                • The credit wallet, its balance of {nf.format(confirming.balance)} credits, and
                its transaction history
              </li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500">
              The account can still sign in. The hashed identity that prevents reward farming
              is kept, so signing up again does not restore the welcome bonus or the one-time
              tasks.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}
