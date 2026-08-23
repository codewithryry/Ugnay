import { NextResponse } from "next/server";
import { loadModelControls } from "@/lib/model-controls";
import { listCatalog, DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exposes which providers/models are usable. Only booleans and model ids cross
 * the wire — API keys stay on the server.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Anything an admin disabled or put under maintenance is not offerable, so
  // the selector shows exactly what routing may actually use.
  const controls = await loadModelControls(supabase);
  const providers = listCatalog()
    .filter((entry) => controls.statusOf(entry.id, "") === "available")
    .map((entry) => ({
      ...entry,
      models: entry.models.filter((m) => controls.statusOf(entry.id, m.id) === "available"),
    }))
    .filter((entry) => entry.models.length > 0);

  return NextResponse.json({
    providers,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
}
