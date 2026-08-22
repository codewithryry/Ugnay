import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Host of a configured URL, or null when it is unset or unparseable. */
function hostOf(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host;
  } catch {
    return null;
  }
}

/**
 * The public origin of this request.
 *
 * Behind a proxy `nextUrl.origin` is the internal one, which would send the
 * signed-in user to the wrong host — but `x-forwarded-host` is caller-supplied,
 * so trusting it outright lets a crafted request bounce the visitor to another
 * site. The configured site URL wins; the forwarded host is only honoured when
 * it is one of the deployment's own known hosts.
 */
function publicOrigin(request: NextRequest) {
  // A local dev session always stays local. Without this, setting
  // NEXT_PUBLIC_SITE_URL to the deployed origin (which production needs) would
  // send every sign-in on localhost off to the live site mid-test.
  const requestHost = request.nextUrl.hostname;
  if (requestHost === "localhost" || requestHost === "127.0.0.1" || requestHost === "[::1]") {
    return request.nextUrl.origin;
  }

  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && hostOf(configured)) return new URL(configured).origin;

  const forwarded = request.headers.get("x-forwarded-host");
  const allowed = new Set(
    [
      request.nextUrl.host,
      hostOf(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      hostOf(process.env.VERCEL_URL),
      ...(process.env.SITE_ALLOWED_HOSTS ?? "").split(",").map((h) => hostOf(h.trim())),
    ].filter(Boolean),
  );

  if (forwarded && allowed.has(forwarded)) {
    const proto = request.headers.get("x-forwarded-proto") === "http" ? "http" : "https";
    return `${proto}://${forwarded}`;
  }

  return request.nextUrl.origin;
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
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("[ugnay] Could not exchange the auth code for a session:", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
