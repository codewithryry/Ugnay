import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Ugnay Credits: the unit an account spends on the paid AI features.
 *
 * Deliberately separate from provider tokens. `public.messages` keeps the real
 * prompt/completion counts a provider reported, which is what usage and cost
 * reporting read; credits are Ugnay's own price on top, set in Admin → Credits.
 *
 * Nothing here writes a balance: every change goes through the security-definer
 * functions `spend_credits` / `grant_credits`, which move the wallet and append
 * to the immutable ledger in one transaction. A client cannot call them.
 */

/** Keys in public.credit_rules that cost credits. */
export type SpendKey = "chat" | "web_search" | "knowledge" | "memory" | "speech";
/** Keys that grant them. */
export type EarnKey = "daily_login" | "streak" | "rewarded_ad";

export interface CreditRule {
  key: string;
  amount: number;
  per: "message" | "thousand_tokens" | "claim";
  enabled: boolean;
  cooldown_seconds: number;
  daily_limit: number;
  description: string;
}

export interface Wallet {
  balance: number;
  total_earned: number;
  total_spent: number;
  streak_days: number;
  last_claim_on: string | null;
}

/** Raised by spend_credits when the wallet cannot cover the charge. */
export const INSUFFICIENT = "insufficient_credits";
/** Raised by award_credits when a grant would breach the supply ceiling. */
export const SUPPLY_LIMIT = "circulation_limit_reached";

export async function loadCreditRules(supabase: SupabaseClient): Promise<CreditRule[]> {
  const { data, error } = await supabase
    .from("credit_rules")
    .select("key, amount, per, enabled, cooldown_seconds, daily_limit, description")
    .order("key");
  if (error) {
    console.error("[ugnay] Could not read the credit rules:", error);
    return [];
  }
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) as CreditRule[];
}

export function findRule(rules: CreditRule[], key: string) {
  const rule = rules.find((r) => r.key === key);
  return rule?.enabled ? rule : null;
}

/**
 * What one turn costs. `chat` is priced per 1,000 tokens the provider actually
 * reported, so a short reply costs less than a long one; the per-message extras
 * are added on top only when they were used. A rule that is missing or
 * disabled contributes nothing.
 */
export function priceTurn(
  rules: CreditRule[],
  used: {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    webSearch?: boolean;
    knowledge?: boolean;
    memory?: boolean;
  },
) {
  // A provider reports a total, or the two halves, or (rarely) nothing at all.
  const tokens =
    used.totalTokens ?? (used.promptTokens ?? 0) + (used.completionTokens ?? 0);
  let total = 0;
  const breakdown: Record<string, number> = {};

  const add = (key: string, amount: number) => {
    if (amount <= 0) return;
    // Four decimals is what the column stores.
    const rounded = Math.round(amount * 10_000) / 10_000;
    breakdown[key] = rounded;
    total += rounded;
  };

  const chat = findRule(rules, "chat");
  if (chat && (tokens > 0 || chat.per === "message")) {
    add("chat", chat.per === "thousand_tokens" ? (chat.amount * tokens) / 1000 : chat.amount);
  }
  for (const [key, on] of [
    ["web_search", used.webSearch],
    ["knowledge", used.knowledge],
    ["memory", used.memory],
  ] as const) {
    const rule = on ? findRule(rules, key) : null;
    if (rule) add(key, rule.amount);
  }

  return { total: Math.round(total * 10_000) / 10_000, breakdown };
}

/**
 * The smallest a turn can cost, used by the pre-flight check before any
 * provider is called. Priced from the same rules as the real charge: one
 * billable unit of chat, plus the per-message extras this request has already
 * asked for, since those are certain before a single token is generated.
 *
 * Nothing is deducted or reserved by asking — this only answers "could the
 * wallet cover the cheapest possible outcome?".
 */
export const MIN_BILLABLE_TOKENS = 1000;

export function minimumTurnCost(
  rules: CreditRule[],
  used: { webSearch?: boolean; knowledge?: boolean; memory?: boolean } = {},
) {
  return priceTurn(rules, { totalTokens: MIN_BILLABLE_TOKENS, ...used }).total;
}

/** The account's balance, creating the wallet row if it somehow has none. */
export async function readBalance(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("credit_wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

/**
 * Charges the wallet. Returns the new balance, or null when the account cannot
 * afford it — the caller decides what that means (the chat route refuses the
 * turn; a best-effort extra simply goes uncharged).
 */
export async function spend(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
  if (amount <= 0) return readBalance(supabase, userId);

  const { data, error } = await supabase.rpc("spend_credits", {
    target_user: userId,
    spend_amount: amount,
    spend_reason: reason,
    spend_metadata: metadata,
  });

  if (error) {
    if (error.message?.includes(INSUFFICIENT)) return null;
    console.error("[ugnay] Could not spend credits:", error);
    return null;
  }
  return Number(data);
}

/**
 * Grants credits. `externalId` is the reward provider's transaction id; a
 * repeat of one already recorded is rejected by the unique index, which is what
 * makes a replayed ad callback harmless.
 */
export async function grant(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
  reason: string,
  externalId: string | null = null,
  metadata: Record<string, unknown> = {},
) {
  const { data, error } = await supabase.rpc("grant_credits", {
    target_user: userId,
    grant_amount: amount,
    grant_reason: reason,
    external_ref: externalId,
    grant_metadata: metadata,
  });
  if (error) {
    console.error("[ugnay] Could not grant credits:", error);
    return null;
  }
  return Number(data);
}

/** True when a failed grant was refused by the circulation ceiling. */
export function isSupplyLimit(error: { message?: string } | null | undefined) {
  return Boolean(error?.message?.includes(SUPPLY_LIMIT));
}

/**
 * Whether a reward may be claimed right now: the rule's cooldown since the last
 * claim, and its allowance for the current UTC day. Both are read from the
 * claims table, which only the definer functions write.
 */
export async function rewardAllowed(
  supabase: SupabaseClient,
  userId: string,
  rule: CreditRule,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from("credit_reward_claims")
    .select("created_at")
    .eq("user_id", userId)
    .eq("rule_key", rule.key)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[ugnay] Could not read the reward claims:", error);
    return { ok: false, reason: "Could not check your reward history." };
  }

  const claims = data ?? [];
  if (rule.cooldown_seconds > 0 && claims[0]) {
    const waited = (Date.now() - new Date(claims[0].created_at).getTime()) / 1000;
    if (waited < rule.cooldown_seconds) {
      const left = Math.ceil((rule.cooldown_seconds - waited) / 60);
      return { ok: false, reason: `Please wait about ${left} more minute${left === 1 ? "" : "s"}.` };
    }
  }

  if (rule.daily_limit > 0) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const today = claims.filter((c) => new Date(c.created_at) >= startOfDay).length;
    if (today >= rule.daily_limit) {
      return { ok: false, reason: "You have claimed this as many times as allowed today." };
    }
  }

  return { ok: true };
}
