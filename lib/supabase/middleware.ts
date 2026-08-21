import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isUnrecoverableAuthError } from "./auth-errors";
import { supabaseEnv } from "./env";

// The manifest is a generated route, so it passes through the middleware and
// must stay reachable without a session or installing the PWA fails.
// "/s" is the read-only shared-conversation view, which must open for anyone.
const PUBLIC_PATHS = ["/login", "/auth", "/s/", "/manifest.webmanifest"];

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
