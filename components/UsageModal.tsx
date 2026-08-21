"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { createClient } from "@/lib/supabase/client";
import { describeDbError, isMissingDbObject } from "@/lib/supabase/errors";
import { useChatStore } from "@/store/chatStore";
import { cn } from "@/lib/utils";

/** Rows returned by public.usage_summary. */
interface SummaryRow {
  provider: string | null;
  model: string | null;
  role: string;
  messages: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Rows returned by public.usage_daily. */
interface DailyRow {
  day: string;
  messages: number;
  total_tokens: number;
}

const RANGES = [
  { id: "7", label: "7 days", days: 7 },
  { id: "30", label: "30 days", days: 30 },
  { id: "all", label: "All time", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

const nf = new Intl.NumberFormat("en-GB");

/** Groups summary rows by one key, totalling messages and tokens. */
function rollUp(rows: SummaryRow[], key: (row: SummaryRow) => string) {
  const totals = new Map<string, { messages: number; tokens: number }>();
  for (const row of rows) {
    const id = key(row);
    const current = totals.get(id) ?? { messages: 0, tokens: 0 };
    current.messages += row.messages;
    current.tokens += row.total_tokens;
    totals.set(id, current);
  }
  return [...totals.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.messages - a.messages);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-950 p-3.5">
      <p className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-neutral-100">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-neutral-600">{hint}</p>}
    </div>
  );
}

/**
 * Real usage for the signed-in account, aggregated in Postgres by
 * `usage_summary` / `usage_daily`.
 *
 * Token counts are what each provider reported and were stored with the
 * message; rows a provider gave no usage for count as zero tokens rather than
 * being guessed at. Ugnay holds no pricing data, so no cost is shown.
 */
export default function UsageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const catalog = useChatStore((s) => s.catalog);
  const [range, setRange] = useState<RangeId>("30");
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rangeId: RangeId) => {
    setLoading(true);
    setError(null);
    const days = RANGES.find((r) => r.id === rangeId)?.days ?? null;
    const since = days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
    const supabase = createClient();

    const [summaryRes, dailyRes] = await Promise.all([
      supabase.rpc("usage_summary", { since }),
      supabase.rpc("usage_daily", { since }),
    ]);

    const failure = summaryRes.error ?? dailyRes.error;
    if (failure) {
      console.error("[ugnay] Could not load usage:", describeDbError(failure));
      setError(
        isMissingDbObject(failure)
          ? "Usage needs the latest database migration. Re-run supabase/schema.sql in the Supabase SQL editor, then reopen this panel."
          : "Could not load your usage. Please try again.",
      );
      setSummary([]);
      setDaily([]);
    } else {
      setSummary((summaryRes.data ?? []) as SummaryRow[]);
      setDaily((dailyRes.data ?? []) as DailyRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(range);
  }, [open, range, load]);

  /** Provider and model ids map to their catalog labels where one exists. */
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of catalog) {
      map.set(`p:${provider.id}`, provider.label);
      for (const model of provider.models) map.set(`m:${model.id}`, model.label);
    }
    return map;
  }, [catalog]);

  const totals = useMemo(() => {
    let messages = 0;
    let sent = 0;
    let received = 0;
    let tokens = 0;
    let withTokens = 0;
    for (const row of summary) {
      messages += row.messages;
      tokens += row.total_tokens;
      if (row.total_tokens > 0) withTokens += row.messages;
      if (row.role === "user") sent += row.messages;
      if (row.role === "assistant") received += row.messages;
    }
    return { messages, sent, received, tokens, withTokens };
  }, [summary]);

  // Replies only: a user turn carries no provider of its own.
  const assistantRows = useMemo(() => summary.filter((r) => r.role === "assistant"), [summary]);
  const byModel = useMemo(
    () => rollUp(assistantRows, (r) => r.model ?? "unknown"),
    [assistantRows],
  );
  const byProvider = useMemo(
    () => rollUp(assistantRows, (r) => r.provider ?? "unknown"),
    [assistantRows],
  );
  const peakDay = useMemo(
    () => daily.reduce((max, d) => Math.max(max, d.messages), 0),
    [daily],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Usage"
      description="Your own messages and the token counts providers reported for them."
      panelClassName="max-w-2xl"
      hideClose
    >
      <div className="flex items-center gap-1.5">
        {RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setRange(option.id)}
            aria-pressed={range === option.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition",
              range === option.id
                ? "border-neutral-500 bg-ink-800 text-neutral-100"
                : "border-ink-700 text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-xs text-rose-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-neutral-500">Loading your usage…</p>
      ) : totals.messages === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">
          No messages in this period.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Messages" value={nf.format(totals.messages)} />
            <Stat
              label="Sent / received"
              value={`${nf.format(totals.sent)} / ${nf.format(totals.received)}`}
            />
            <Stat
              label="Tokens"
              value={nf.format(totals.tokens)}
              hint={
                totals.withTokens < totals.received
                  ? `${nf.format(totals.received - totals.withTokens)} replies reported none`
                  : undefined
              }
            />
          </div>

          {daily.length > 1 && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Messages per day
              </p>
              <div className="flex h-16 items-end gap-[2px]" role="img" aria-label="Daily message activity">
                {daily.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${nf.format(d.messages)} messages`}
                    style={{ height: `${peakDay ? Math.max(4, (d.messages / peakDay) * 100) : 4}%` }}
                    className="min-w-[3px] flex-1 rounded-sm bg-ink-700"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              By model
            </p>
            <ul className="space-y-1">
              {byModel.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-neutral-200">
                    {labels.get(`m:${row.id}`) ?? row.id}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                    {nf.format(row.messages)} replies · {nf.format(row.tokens)} tokens
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              By provider
            </p>
            <ul className="space-y-1">
              {byProvider.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-neutral-200">
                    {labels.get(`p:${row.id}`) ?? row.id}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-neutral-500">
                    {nf.format(row.messages)} replies · {nf.format(row.tokens)} tokens
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-5 text-[11px] leading-relaxed text-neutral-600">
            Counts come from your stored messages. Tokens are what each provider reported — some
            do not report any, so those replies contribute zero. Ugnay stores no pricing, so no
            cost is estimated.
          </p>
        </>
      )}
    </Modal>
  );
}
