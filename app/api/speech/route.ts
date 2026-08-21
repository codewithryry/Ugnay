import { NextResponse, type NextRequest } from "next/server";
import { MAX_SPEECH_CHARS, createSpeechStream, speechConfigured } from "@/lib/providers/speech";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long replies take a while to synthesise. */
export const maxDuration = 60;

/** Speech syntheses allowed per account per minute. */
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;

/**
 * Reads a message aloud: streams synthesised audio for the given text back to
 * the caller. Authenticated like every other route; the provider key stays on
 * the server.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/speech could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  // Keyed by account, so one caller cannot spend another's budget.
  const limit = rateLimit(`speech:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  if (!speechConfigured()) {
    return NextResponse.json(
      { error: "Text to speech is unavailable: no provider key is configured." },
      { status: 503 },
    );
  }

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim().slice(0, MAX_SPEECH_CHARS);
  if (!text) return NextResponse.json({ error: "Nothing to read aloud." }, { status: 400 });

  try {
    const audio = await createSpeechStream(text);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[ugnay] /api/speech failed:", err);
    return NextResponse.json(
      { error: "Could not read this message aloud. Please try again." },
      { status: 502 },
    );
  }
}
