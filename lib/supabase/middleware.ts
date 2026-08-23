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

  // Refreshes the auth token and keeps cookies in sync.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // A session pointing at a user GoTrue cannot resolve ("User not found")
  // poisons every later request. Clear it here so the visitor lands on a clean
  // sign-in instead of failing on each API call.
  if (isUnrecoverableAuthError(userError)) {
    console.error("[ugnay] Clearing an unusable session:", userError);
    await supabase.auth.signOut();
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
    const { data: site } = await supabase
      .from("ai_settings")
      .select("site_maintenance")
      .eq("id", true)
      .maybeSingle();

    if (site?.site_maintenance) {
      // Admin is resolved from the database, not from the URL: /admin is a
      // protected route, never a bypass.
      const { data: profile } = user
        ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
        : { data: null };

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
