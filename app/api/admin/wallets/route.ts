import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { SUPPLY_LIMIT } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404-shaped denial, like the other admin routes. */
function denied() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

/**
 * The wallet table, or one wallet with its ledger when `user` is given.
 *
 * Both come from security-definer functions that re-check the caller's role in
 * the database, because RLS rightly hides other accounts' wallets. Admin
 * accounts are excluded from the circulation totals: they are entitled rather
 * than funded, so their balances are not credits in circulation.
 */
export async function GET(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();
  const supabase = await createClient();
  const params = request.nextUrl.searchParams;
  const user = params.get("user");

  if (user) {
    const { data, error } = await supabase.rpc("admin_credit_wallet", { target_user: user });
    if (error) {
      console.error("[ugnay] Could not read that wallet:", error);
      return NextResponse.json({ error: "Could not load that wallet." }, { status: 500 });
    }
    return NextResponse.json(data ?? {});
  }

  const { data, error } = await supabase.rpc("admin_credit_wallets", {
    search: params.get("q"),
    limit_count: 50,
  });
  if (error) {
    console.error("[ugnay] Could not read the wallets:", error);
    return NextResponse.json({ error: "Could not load the wallets." }, { status: 500 });
  }
  return NextResponse.json(data ?? {});
}

/**
 * Adds or removes credits on one wallet, with a reason recorded on the ledger.
 *
 * Both write through security-definer functions that are admin-only in the
 * database: grant_credits() (which enforces the circulation ceiling inside the
 * same transaction) and remove_credits() (which refuses to take more than a
 * wallet holds). Nothing here, and nothing in the browser, moves a balance on
 * its own, and no historical row is ever rewritten.
 */
/**
 * Permanently removes one account's application data.
 *
 * All of it happens in admin_delete_user_data(), which is admin-only in the
 * database, refuses the caller's own account and any other admin, and keeps the
 * append-only ledger and the anti-farming identity record. The auth user is
 * left alone: this clears what an account made, not the account itself.
 */
export async function DELETE(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "Which account?" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_delete_user_data", {
    target_user: body.userId,
  });

  if (error) {
    console.error("[ugnay] Could not delete that account's data:", error);
    return NextResponse.json({ error: "Could not delete that data." }, { status: 500 });
  }
  // The function answers with its own reason when it refuses.
  if (!data?.ok) {
    return NextResponse.json({ error: data?.reason ?? "Could not delete that data." }, {
      status: 400,
    });
  }
  return NextResponse.json({ ok: true, removed: data.removed });
}

export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: { userId?: string; amount?: number; note?: string; action?: "grant" | "remove" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const amount = Number(body.amount);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!body.userId) return NextResponse.json({ error: "Which wallet?" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be more than zero." }, { status: 400 });
  }
  // An adjustment without a reason is an unexplained balance later on.
  if (!note) {
    return NextResponse.json({ error: "Give a reason for this adjustment." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (body.action === "remove") {
    const { data, error } = await supabase.rpc("remove_credits", {
      target_user: body.userId,
      take_amount: amount,
      note: note.slice(0, 400),
    });
    if (error) {
      console.error("[ugnay] Could not remove credits:", error);
      return NextResponse.json({ error: "Could not remove the credits." }, { status: 500 });
    }
    // The function answers with its own reason when it refuses.
    if (!data?.ok) {
      return NextResponse.json({ error: data?.reason ?? "Could not remove the credits." }, {
        status: 400,
      });
    }
    return NextResponse.json({ ok: true, balance: Number(data.balance) });
  }

  const { data, error } = await supabase.rpc("grant_credits", {
    target_user: body.userId,
    grant_amount: amount,
    grant_reason: "admin_grant",
    external_ref: null,
    grant_metadata: { granted_by: user?.id ?? null, note: note.slice(0, 400) },
  });

  if (error) {
    if (error.message?.includes(SUPPLY_LIMIT)) {
      return NextResponse.json(
        {
          error:
            "That grant would take circulation past the maximum. Raise the limit in Credits, or remove credits elsewhere first.",
          code: SUPPLY_LIMIT,
        },
        { status: 409 },
      );
    }
    console.error("[ugnay] Could not grant credits:", error);
    return NextResponse.json({ error: "Could not grant the credits." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, balance: Number(data) });
}
