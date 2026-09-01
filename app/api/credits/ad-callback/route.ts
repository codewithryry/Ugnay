import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { findRule, grant, loadCreditRules, rewardAllowed } from "@/lib/credits";
import { rewardedAdsConfigured, verifyAdCallback } from "@/lib/rewarded-ads";
import { supabaseEnv } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server callback from the rewarded-ad network.
 *
 * The ad network calls this after it has confirmed the view; the browser never
 * does. The HMAC over user id, transaction id and timestamp is what proves it,
 * and the transaction id is recorded, so the same view can only ever pay once.
 *
 * There is no session here — the caller is the network, not the user — so the
 * grant runs under the service role against the same security-definer function
 * every other credit change uses. Without SUPABASE_SERVICE_ROLE_KEY the feature
 * stays off rather than half working.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const userId = params.get("user_id") ?? "";
  const transactionId = params.get("transaction_id") ?? "";
  const timestamp = Number(params.get("timestamp") ?? "0");
  const signature = params.get("signature") ?? "";

  if (!rewardedAdsConfigured()) {
    console.error("[ugnay] Rewarded ads are not configured; callback ignored.");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const verdict = verifyAdCallback({ userId, transactionId, timestamp, signature });
  if (!verdict.ok) {
    console.error(`[ugnay] Rejected a rewarded-ad callback: ${verdict.reason}`);
    // Deliberately terse: a network retries on a non-2xx, and the reason is a
    // server concern.
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const { url } = supabaseEnv();
  const supabase = createServiceClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const rule = findRule(await loadCreditRules(supabase), "rewarded_ad");
  if (!rule) return NextResponse.json({ ok: false }, { status: 409 });

  const allowed = await rewardAllowed(supabase, userId, rule);
  if (!allowed.ok) {
    console.error(`[ugnay] Rewarded ad not granted for ${userId}: ${allowed.reason}`);
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const balance = await grant(supabase, userId, rule.amount, "rewarded_ad", transactionId, {
    network: params.get("network") ?? "unknown",
  });

  // A duplicate transaction id trips the unique index and lands here; the view
  // was already paid for, so the network is told everything is fine.
  if (balance === null) return NextResponse.json({ ok: true, duplicate: true });

  return NextResponse.json({ ok: true });
}
