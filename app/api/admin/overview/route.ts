import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Totals for the /admin dashboard. Everything comes from public.admin_overview(),
 * which re-checks the caller's role in the database, so RLS is never widened
 * for these reads.
 */
export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) {
    console.error("[ugnay] Could not load the admin overview:", error);
    return NextResponse.json({ error: "Could not load the dashboard." }, { status: 500 });
  }
  return NextResponse.json(data ?? {});
}
