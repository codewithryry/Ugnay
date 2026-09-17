import { NextResponse, type NextRequest } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  // A CORS preflight is answered before anything else. The browser sends it
  // without the Authorization header, so running it through the auth gate
  // below would deny the request the app is only asking permission to make.
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    return corsPreflight(request);
  }

  // Supabase sends the OAuth code to the Site URL when the redirect target is
  // not in its allow-list, so it can land on any page instead of the callback.
  // Only /auth/callback exchanges it, and the auth gate below would otherwise
  // drop it, so forward it there and carry on to where the visitor was headed.
  if (code && !pathname.startsWith("/auth/callback") && !pathname.startsWith("/api/")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/auth/callback";
    redirect.search = "";
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("next", searchParams.get("next") ?? pathname);
    return NextResponse.redirect(redirect);
  }

  const response = await updateSession(request);

  // Route handlers answer the Android app cross-origin, so their responses
  // need the CORS headers the browser checks before revealing the body. Pages
  // are same-origin only and are left untouched.
  return pathname.startsWith("/api/") ? withCors(response, request) : response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
