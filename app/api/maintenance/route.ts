import { NextResponse } from "next/server";
import { loadModelControls } from "@/lib/model-controls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The site switch, and nothing else. Public because the maintenance screen
 * polls it while signed out, so the page can send people back to Ugnay the
 * moment an admin turns maintenance off.
 */
export async function GET() {
  const supabase = await createClient();
  const { settings } = await loadModelControls(supabase);
  return NextResponse.json({ maintenance: settings.siteMaintenance });
}
