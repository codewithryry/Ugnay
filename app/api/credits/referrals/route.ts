import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's own invite standing: their code, what a referral pays, how many
 * have qualified, and the history behind those numbers.
 *
 * Strictly read-only. It creates no identity, mints no code, settles no
 * referral and grants nothing — referral_summary() is a SELECT-only function
 * and every write path lives behind the POST below. An account that has no
 * identity row yet simply reports no code and no history, which is accurate:
 * it has neither invited anyone nor been invited.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase.rpc("referral_summary");
  if (error) {
    console.error("[ugnay] Could not read the referral summary:", error);
    return NextResponse.json({ error: "Could not load your invites." }, { status: 500 });
  }

  return NextResponse.json(data ?? {});
}

/**
 * The write side of invites. Two actions, both explicit:
 *
 *   "code"   — mints this account's invite code if it does not have one yet,
 *              and settles any referral the caller owes. Asked for by the
 *              modal when the person actually wants to share a link, rather
 *              than happening invisibly on a read.
 *   "accept" — redeems someone else's code. This never pays the referrer: it
 *              records a pending referral, and the reward is decided later by
 *              settle_referral(), once the invited account has done the
 *              qualifying action.
 *
 * Self-referral, a second code and an already invited identity are all refused
 * inside the database functions, which compare persistent identity hashes
 * rather than account ids.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { action?: "code" | "accept"; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "code") {
    // Minting needs the identity row, so this is where credit_identity() is
    // allowed to create it: a write request, in a write transaction.
    const { data: code, error: codeError } = await supabase.rpc("referral_code");
    if (codeError) {
      console.error("[ugnay] Could not mint the referral code:", codeError);
      return NextResponse.json({ error: "Could not create your invite code." }, { status: 500 });
    }

    // Settling belongs on a write request too. It pays the person who invited
    // *this* account, and only once the qualifying action is genuinely done —
    // the check runs in the database against the caller's own rows.
    const { error: settleError } = await supabase.rpc("settle_referral");
    if (settleError) console.error("[ugnay] Could not settle the referral:", settleError);

    return NextResponse.json({ ok: true, code });
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) return NextResponse.json({ error: "Enter an invite code." }, { status: 400 });

  const { data, error } = await supabase.rpc("accept_referral", { code: code.slice(0, 16) });
  if (error) {
    console.error("[ugnay] Could not accept the referral:", error);
    return NextResponse.json({ error: "Could not use that code." }, { status: 500 });
  }
  return NextResponse.json(data ?? { ok: false });
}
