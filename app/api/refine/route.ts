import { NextResponse, type NextRequest } from "next/server";
import { ProviderError, resolveModel } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dictation passes allowed per account per minute. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

/** Dictation is short; keep the call small and bounded. */
const MAX_INPUT_CHARS = 4000;

const INSTRUCTIONS = {
  tidy:
    "Clean up this speech-to-text transcription: fix grammar, punctuation and " +
    "capitalisation, and drop filler words. Keep the wording and meaning otherwise " +
    "identical. Reply with the corrected text only.",
  full:
    "Rewrite this speech-to-text transcription for maximum clarity and concision " +
    "while preserving every fact and intent. Reply with the rewritten text only.",
} as const;

/**
 * Refines a dictated transcription using the user's configured provider and the
 * mode saved in Settings → Behavior → Dictation Refinement. "No refinement"
 * never reaches this route: the client inserts the raw transcript instead.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/refine could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  // Keyed by account, so one caller cannot spend another's budget.
  const limit = rateLimit(`refine:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim().slice(0, MAX_INPUT_CHARS);
  if (!text) return NextResponse.json({ error: "Nothing to refine." }, { status: 400 });

  const { data: settings } = await supabase
    .from("user_settings")
    .select("dictation_refinement, default_provider, default_model")
    .eq("user_id", user.id)
    .maybeSingle();

  const mode = settings?.dictation_refinement ?? "none";
  if (mode === "none") return NextResponse.json({ text });

  let provider: ReturnType<typeof resolveModel>["provider"];
  let model: string;
  try {
    ({ provider, model } = resolveModel(
      settings?.default_provider ?? "openrouter",
      settings?.default_model ?? "openrouter/free",
    ));
  } catch (err) {
    console.error("[ugnay] /api/refine could not resolve the model:", err);
    return NextResponse.json({ text });
  }

  try {
    let refined = "";
    for await (const event of provider.streamChat({
      model,
      messages: [
        { role: "system", content: INSTRUCTIONS[mode as "tidy" | "full"] },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      maxTokens: 800,
    })) {
      if (event.type === "delta") refined += event.text;
    }

    // Fall back to the raw transcription rather than losing the user's words.
    return NextResponse.json({ text: refined.trim() || text });
  } catch (err) {
    const message =
      err instanceof ProviderError ? err.message : "Could not refine the transcription.";
    console.error("[ugnay] /api/refine failed:", err);
    return NextResponse.json({ text, error: message });
  }
}
