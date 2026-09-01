import { NextResponse } from "next/server";
import { SUPPLY_LIMIT } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Claims the daily reward (and the streak bonus that rides on it).
 *
 * All of the work happens in `claim_daily_credits()`, which locks the wallet,
 * checks the claim date and appends to the ledger in one transaction — so two
 * taps, two tabs or a replayed request can only ever grant one day's credits.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase.rpc("claim_daily_credits");
  if (error) {
    // The supply ceiling is a state of the economy, not a fault.
    if (error.message?.includes(SUPPLY_LIMIT)) {
      return NextResponse.json(
        { error: "Ugnay has reached its credit supply limit. Please try again later." },
        { status: 409 },
      );
    }
    console.error("[ugnay] Could not claim the daily credits:", error);
    return NextResponse.json({ error: "Could not claim your credits." }, { status: 500 });
  }

  return NextResponse.json(data ?? { claimed: false });
}
