import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { loadCreditRules } from "@/lib/credits";
import { rewardedAdsConfigured } from "@/lib/rewarded-ads";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's own wallet: balance, totals, recent ledger and the prices in
 * force. RLS scopes every read to the account, and the balance is never
 * writable from here — only the spend/grant functions move it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Once per identity, ever: the function decides, not this route. Done before
  // the wallet is read so a new account sees the bonus on its first look.
  const { error: signupError } = await supabase.rpc("claim_signup_credits");
  if (signupError) console.error("[ugnay] Could not settle the signup bonus:", signupError);

  const [walletRes, ledgerRes, rules] = await Promise.all([
    supabase
      .from("credit_wallets")
      .select("balance, total_earned, total_spent, streak_days, last_claim_on")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("id, amount, kind, reason, balance_after, metadata, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    loadCreditRules(supabase),
  ]);

  if (walletRes.error) {
    console.error("[ugnay] Could not read the wallet:", walletRes.error);
    return NextResponse.json({ error: "Could not load your credits." }, { status: 500 });
  }

  const wallet = walletRes.data ?? {
    balance: 0,
    total_earned: 0,
    total_spent: 0,
    streak_days: 0,
    last_claim_on: null,
  };

  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    wallet: {
      balance: Number(wallet.balance),
      totalEarned: Number(wallet.total_earned),
      totalSpent: Number(wallet.total_spent),
      streakDays: wallet.streak_days,
      dailyClaimed: wallet.last_claim_on === today,
    },
    transactions: (ledgerRes.data ?? []).map((t) => ({
      ...t,
      amount: Number(t.amount),
      balance_after: Number(t.balance_after),
    })),
    rules: rules.filter((r) => r.enabled),
    // The browser cannot grant itself an ad reward; this only says whether the
    // network is configured at all, so the UI knows to offer it.
    rewardedAds: rewardedAdsConfigured(),
    // Admins do not spend credits. Reported so the wallet can say so; the
    // exemption itself is decided server-side on every request.
    unlimited: await isCurrentUserAdmin(),
  });
}
