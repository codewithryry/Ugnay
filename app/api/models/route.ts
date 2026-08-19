import { NextResponse } from "next/server";
import { listCatalog, DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exposes which providers/models are usable. Only booleans and model ids cross
 * the wire — API keys stay on the server.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json({
    providers: listCatalog(),
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
}
