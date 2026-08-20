import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The public origin of this request. Behind Vercel's proxy `nextUrl.origin` is
 * the internal one, which would send the signed-in user to the wrong host, so
 * the forwarded headers win when they are present.
 */
function publicOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host");
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Keeps `next` a path on this site, so the callback cannot bounce elsewhere. */
function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/**
 * Exchanges the Supabase auth code for a session. Used by both flows: email
 * confirmation / magic links, and Google, which arrives here after Supabase's
 * own /auth/v1/callback.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const origin = publicOrigin(request);

  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[ugnay] Could not exchange the auth code for a session:", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
