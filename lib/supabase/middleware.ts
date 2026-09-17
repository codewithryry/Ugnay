import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isUnrecoverableAuthError } from "./auth-errors";
import { supabaseEnv } from "./env";

// The manifest is a generated route, so it passes through the middleware and
// must stay reachable without a session or installing the PWA fails.
// "/s" is the read-only shared-conversation view, which must open for anyone.
// The legal pages are linked from the signed-out landing and from /login, so
// they have to open without a session too. "/faq" and "/release-notes" join
// them because they link to each other and are static content — neither reads
// any account data. /release-notes renders standalone when there is no session.
const PUBLIC_PATHS = [
  "/login",
  // The maintenance screen has to render for signed-out visitors too.
  "/maintenance",
  "/auth",
  "/s/",
  "/about",
  "/terms",
  "/privacy",
  "/faq",
  "/release-notes",
  "/manifest.webmanifest",
];

/**
 * Vercel stops a middleware invocation that has not answered in 25s, and the
 * whole request then 504s — so nothing in here may wait on the network without
 * a bound. Supabase Auth and PostgREST are a different service in a different
 * region, and when either is slow or rate limiting (429 on /auth/v1/token, for
 * example, which retries internally) an un-timed await simply hangs until the
 * platform kills it.
 *
 * A budget turns that failure into a decision. If a call has not answered in
 * time we fall back to "no session", which is the safe direction: a signed-in
 * visitor is treated as signed out and sent to sign in, never the reverse.
 */
const AUTH_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 2_000;

/**
 * Resolves to `fallback` if the promise has not settled in time, and never
 * rejects. The underlying request is left to finish on its own — there is
 * nothing useful to cancel, and the cookies it may set are written by the
 * client's own setAll.
 */
async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The site-maintenance flag, cached in the runtime's memory.
 *
 * Without this, every request — including every signed-out one — made a
 * PostgREST round trip before it could render, on top of the auth call. That
 * is a database query on the hot path of a page that does not otherwise need
 * one, and it is the second of the sequential waits that made a slow Supabase
 * into a 25s timeout.
 *
 * A few seconds of staleness is the right trade here: the maintenance screen
 * already polls /api/maintenance and moves tabs in and out on its own, so the
 * switch still takes effect promptly without every visitor paying for it.
 */
let maintenanceCache: { value: boolean; at: number } | null = null;
const MAINTENANCE_TTL_MS = 10_000;

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the auth token and keeps cookies in sync. Bounded: a slow or
  // rate-limited GoTrue must not hold the whole request open until Vercel
  // kills it. On timeout we proceed as "no session", so protection is never
  // loosened by a slow dependency — only tightened.
  const authResult = await withTimeout(supabase.auth.getUser(), AUTH_TIMEOUT_MS);
  const user = authResult?.data.user ?? null;
  const userError = authResult?.error ?? null;

  // A session pointing at a user GoTrue cannot resolve ("User not found")
  // poisons every later request. Clear it here so the visitor lands on a clean
  // sign-in instead of failing on each API call.
  if (isUnrecoverableAuthError(userError)) {
    console.error("[ugnay] Clearing an unusable session:", userError);
    await withTimeout(supabase.auth.signOut(), AUTH_TIMEOUT_MS);
    if (!request.nextUrl.pathname.startsWith("/api/")) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.search = "";
      return NextResponse.redirect(redirect, { headers: response.headers });
    }
  }

  const { pathname } = request.nextUrl;

  // Whole-site maintenance: everything is closed except the maintenance screen
  // itself, the sign-in routes an admin needs to get in, and the admin surface
  // once they are in. Checked here, before any other gate, so a direct URL, a
  // refresh and a client route change are all blocked the same way.
  const maintenanceExempt =
    pathname.startsWith("/maintenance") ||
    pathname.startsWith("/auth") ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    // Polled by the maintenance screen so it can leave on its own.
    pathname === "/api/maintenance" ||
    // The admin surface guards itself: the page 404s and every /api/admin
    // route denies unless profiles.role is 'admin'. Letting it through here is
    // what keeps an admin from being locked out by their own switch.
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin");

  if (!maintenanceExempt) {
    // Served from memory while it is fresh, so the common request does no
    // database work at all. A cold instance pays for one bounded read.
    const now = Date.now();
    let maintenance = maintenanceCache;
    if (!maintenance || now - maintenance.at > MAINTENANCE_TTL_MS) {
      const settings = await withTimeout(
        supabase.from("ai_settings").select("site_maintenance").eq("id", true).maybeSingle(),
        QUERY_TIMEOUT_MS,
      );
      // Unreachable settings must not close the site by accident: the gate is
      // a deliberate switch, so absent an answer we leave Ugnay open and let
      // the per-route checks do their job. A timeout is not cached, so the
      // next request tries again rather than being stuck for the full TTL.
      if (settings) {
        maintenance = { value: Boolean(settings.data?.site_maintenance), at: now };
        maintenanceCache = maintenance;
      } else {
        maintenance = { value: false, at: 0 };
      }
    }

    if (maintenance.value) {
      // Admin is resolved from the database, not from the URL: /admin is a
      // protected route, never a bypass.
      // Only reached while maintenance is actually on, so this is off the hot
      // path — but still bounded, because it sits in front of the redirect.
      const profileResult = user
        ? await withTimeout(
            supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
            QUERY_TIMEOUT_MS,
          )
        : null;
      const profile = profileResult?.data ?? null;

      if (profile?.role !== "admin") {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Ugnay is down for maintenance. Please check back shortly." },
            { status: 503, headers: response.headers },
          );
        }
        const redirect = request.nextUrl.clone();
        redirect.pathname = "/maintenance";
        redirect.search = "";
        return NextResponse.redirect(redirect);
      }
    }
  }

  // Route handlers answer with their own 401 JSON rather than an HTML redirect.
  if (pathname.startsWith("/api/")) return response;

  // The landing New Chat is reachable signed out. Matched exactly, because
  // PUBLIC_PATHS is a prefix list and "/" there would expose every route.
  const isPublic = pathname === "/" || PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && pathname === "/login") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}
