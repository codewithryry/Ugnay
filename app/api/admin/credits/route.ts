import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { grant, loadCreditRules } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404-shaped denial, like the other admin routes. */
function denied() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

/** Every rule, plus what the economy has issued and consumed so far. */
export async function GET() {
  if (!(await isCurrentUserAdmin())) return denied();
  const supabase = await createClient();

  const [rules, wallets, tasks, settings] = await Promise.all([
    loadCreditRules(supabase),
    supabase.from("credit_wallets").select("balance, total_earned, total_spent"),
    supabase
      .from("credit_tasks")
      .select("key, title, description, amount, enabled, repeatable, cooldown_seconds, daily_limit, sort_order")
      .order("sort_order"),
    supabase.from("ai_settings").select("max_circulation").eq("id", true).maybeSingle(),
  ]);

  const totals = (wallets.data ?? []).reduce(
    (acc, w) => ({
      balance: acc.balance + Number(w.balance),
      earned: acc.earned + Number(w.total_earned),
      spent: acc.spent + Number(w.total_spent),
      wallets: acc.wallets + 1,
    }),
    { balance: 0, earned: 0, spent: 0, wallets: 0 },
  );

  return NextResponse.json({
    rules,
    totals,
    tasks: (tasks.data ?? []).map((t) => ({ ...t, amount: Number(t.amount) })),
    // 0 means no ceiling. Enforced in the database, shown here.
    maxCirculation: Number(settings.data?.max_circulation ?? 0),
  });
}

/** Edits one rule: price, reward amount, cooldown, daily limit, on/off. */
export async function PATCH(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: {
    key?: string;
    amount?: number;
    enabled?: boolean;
    cooldownSeconds?: number;
    dailyLimit?: number;
    /** Set to edit a task in credit_tasks rather than a rule. */
    task?: boolean;
    repeatable?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.key !== "string" || !body.key) {
    return NextResponse.json({ error: "Which rule?" }, { status: 400 });
  }
  if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount < 0)) {
    return NextResponse.json({ error: "Amount must be zero or more." }, { status: 400 });
  }
  // A zero daily limit means "no limit", which must never apply to rewarded
  // ads. The database refuses it too; this is the readable version.
  if (
    !body.task &&
    body.key === "rewarded_ad" &&
    body.dailyLimit !== undefined &&
    !(Number(body.dailyLimit) >= 1)
  ) {
    return NextResponse.json(
      { error: "Rewarded ads need a daily limit of at least 1." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // A task is edited in its own table; everything else is a pricing rule.
  if (body.task) {
    const { error: taskError } = await supabase
      .from("credit_tasks")
      .update({
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.repeatable === "boolean" ? { repeatable: body.repeatable } : {}),
        ...(Number.isFinite(body.cooldownSeconds)
          ? { cooldown_seconds: Math.max(0, Math.trunc(body.cooldownSeconds as number)) }
          : {}),
        ...(Number.isFinite(body.dailyLimit)
          ? { daily_limit: Math.max(0, Math.trunc(body.dailyLimit as number)) }
          : {}),
        updated_by: user?.id ?? null,
      })
      .eq("key", body.key);

    if (taskError) {
      console.error("[ugnay] Could not save the credit task:", taskError);
      return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Update, never insert: the keys are the ones the app knows how to charge.
  const { error } = await supabase
    .from("credit_rules")
    .update({
      ...(body.amount !== undefined ? { amount: body.amount } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(Number.isFinite(body.cooldownSeconds)
        ? { cooldown_seconds: Math.max(0, Math.trunc(body.cooldownSeconds as number)) }
        : {}),
      ...(Number.isFinite(body.dailyLimit)
        ? { daily_limit: Math.max(0, Math.trunc(body.dailyLimit as number)) }
        : {}),
      updated_by: user?.id ?? null,
    })
    .eq("key", body.key);

  if (error) {
    console.error("[ugnay] Could not save the credit rule:", error);
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Grants credits to one account by email, recorded as 'admin_grant'. */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: { email?: string; amount?: number; note?: string; maxCirculation?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Setting the supply ceiling comes through the same admin endpoint.
  if (body.maxCirculation !== undefined) {
    const max = Number(body.maxCirculation);
    if (!Number.isFinite(max) || max < 0) {
      return NextResponse.json({ error: "The limit must be zero or more." }, { status: 400 });
    }
    const supabaseSettings = await createClient();
    const { error } = await supabaseSettings
      .from("ai_settings")
      .update({ max_circulation: max })
      .eq("id", true);
    if (error) {
      console.error("[ugnay] Could not save the circulation limit:", error);
      return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const amount = Number(body.amount);
  if (!email) return NextResponse.json({ error: "Which account?" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be more than zero." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "No account with that email." }, { status: 404 });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const balance = await grant(supabase, profile.id, amount, "admin_grant", null, {
    granted_by: user?.id ?? null,
    note: typeof body.note === "string" ? body.note.slice(0, 200) : "",
  });

  if (balance === null) {
    return NextResponse.json({ error: "Could not grant the credits." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, balance });
}
