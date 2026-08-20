import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches the check constraint on public.app_feedback. */
const KINDS = new Set(["idea", "bug", "other"]);
const MESSAGE_LIMIT = 4000;

/** Stores one feedback submission for the signed-in account. */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { kind?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "Pick what your feedback is about." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Feedback cannot be empty." }, { status: 400 });
  }
  if (message.length > MESSAGE_LIMIT) {
    return NextResponse.json(
      { error: `Keep feedback under ${MESSAGE_LIMIT} characters.` },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("app_feedback")
    .insert({ user_id: user.id, kind, message });

  if (error) {
    console.error("[ugnay] Could not store the feedback:", error);
    return NextResponse.json({ error: "Could not send your feedback." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
