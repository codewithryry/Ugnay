import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const code = searchParams.get("code");

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

  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
