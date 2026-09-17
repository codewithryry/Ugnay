import { NextResponse, type NextRequest } from "next/server";

/**
 * Cross-origin access for the Android app.
 *
 * The web app is same-origin and needs none of this. The APK serves its UI
 * from inside the package, so its requests carry an Origin the browser will
 * check against these headers before handing the response to the page.
 *
 * Capacitor's WebView origin differs by platform and configuration, so the
 * allow-list holds the ones Capacitor actually uses rather than a wildcard.
 * `*` is not an option even setting safety aside: it is what a hostile page in
 * any browser would need to read a signed-in user's API responses, and this
 * API answers with their conversations.
 */
const ALLOWED_ORIGINS = new Set(
  [
    // Android WebView, and the http scheme Capacitor uses when
    // `androidScheme` is left at its default.
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
    // Extra origins for local device testing against a dev server.
    ...(process.env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  ].filter(Boolean),
);

/** The echo-back origin for this request, or null when it is not allowed. */
export function allowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return ALLOWED_ORIGINS.has(origin) ? origin : null;
}

/**
 * Adds the CORS headers to a response when the caller's origin is allowed.
 *
 * `Vary: Origin` is set unconditionally, including for disallowed origins:
 * without it a CDN or the browser cache could serve one origin's response,
 * headers and all, to another.
 */
export function withCors<T extends Response>(response: T, request: NextRequest): T {
  response.headers.append("Vary", "Origin");

  const origin = allowedOrigin(request);
  if (!origin) return response;

  response.headers.set("Access-Control-Allow-Origin", origin);
  // The session travels in the Authorization header, never a cookie, so
  // credentialed mode is unnecessary here — and leaving it off keeps the
  // browser from ever attaching ambient cookies to these requests.
  response.headers.set("Access-Control-Expose-Headers", "Content-Type");
  return response;
}

/** The preflight answer for an allowed origin, or 403 for anything else. */
export function corsPreflight(request: NextRequest): NextResponse {
  const origin = allowedOrigin(request);
  if (!origin) {
    const denied = new NextResponse(null, { status: 403 });
    denied.headers.append("Vary", "Origin");
    return denied;
  }

  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Max-Age", "86400");
  response.headers.append("Vary", "Origin");
  return response;
}
