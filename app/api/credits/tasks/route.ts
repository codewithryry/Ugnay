import { NextResponse, type NextRequest } from "next/server";
import { SUPPLY_LIMIT } from "@/lib/credits";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tasks & Rewards: what the account can earn, and where it stands on each.
 *
 * Status is computed in the database from the account's own rows — a finished
 * task is one Ugnay can see was finished, never one the browser claims. The
 * claim itself goes through claim_credit_task(), which re-checks everything.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const [tasksRes, progressRes, claimsRes] = await Promise.all([
    supabase
      .from("credit_tasks")
      .select("key, title, description, amount, repeatable, cooldown_seconds, daily_limit, action_href, sort_order")
      .eq("enabled", true)
      .order("sort_order"),
    supabase.rpc("credit_task_progress"),
    // By identity, not by account, so a recreated account cannot claim a
    // one-time task twice.
    supabase.rpc("credit_task_claimed"),
  ]);

  if (tasksRes.error) {
    console.error("[ugnay] Could not read the credit tasks:", tasksRes.error);
    return NextResponse.json({ error: "Could not load the tasks." }, { status: 500 });
  }
  if (progressRes.error) console.error("[ugnay] Could not read task progress:", progressRes.error);

  const done = new Map<string, boolean>(
    ((progressRes.data ?? []) as Array<{ task_key: string; done: boolean }>).map((r) => [
      r.task_key,
      r.done,
    ]),
  );
  const claims = (claimsRes.data ?? []) as Array<{
    task_key: string;
    claimed_on: string | null;
    created_at: string;
  }>;
  const today = new Date().toISOString().slice(0, 10);

  const tasks = (tasksRes.data ?? []).map((task) => {
    const mine = claims.filter((c) => c.task_key === task.key);
    const claimedToday = mine.filter((c) => c.claimed_on === today).length;
    const claimed = task.repeatable
      ? task.daily_limit > 0 && claimedToday >= task.daily_limit
      : mine.some((c) => c.claimed_on === null);

    return {
      key: task.key,
      title: task.title,
      description: task.description,
      amount: Number(task.amount),
      repeatable: task.repeatable,
      actionHref: task.action_href,
      done: done.get(task.key) ?? false,
      claimed,
    };
  });

  return NextResponse.json({ tasks });
}

/** Claims one finished task. Everything that matters is decided in the database. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.key !== "string" || !body.key) {
    return NextResponse.json({ error: "Which task?" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("claim_credit_task", { task: body.key });
  if (error) {
    if (error.message?.includes(SUPPLY_LIMIT)) {
      return NextResponse.json(
        { error: "Ugnay has reached its credit supply limit. Please try again later." },
        { status: 409 },
      );
    }
    console.error("[ugnay] Could not claim the task:", error);
    return NextResponse.json({ error: "Could not claim that task." }, { status: 500 });
  }
  return NextResponse.json(data ?? { claimed: false });
}
