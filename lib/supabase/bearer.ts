import { headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Bearer-token Supabase clients, for callers that cannot send cookies.
 *
 * The web app authenticates with `@supabase/ssr` cookies, which the browser
 * attaches automatically because the page and the API share an origin. The
 * Android build does not: its WebView serves the UI from `capacitor://` (or
 * `https://localhost` on some devices) and calls the API cross-origin, where
 * those cookies are neither sent nor settable. The session still exists — the
 * Supabase JS client holds it in the WebView's localStorage — so the app sends
 * it explicitly as `Authorization: Bearer <access_token>`.
 *
 * This changes only how the token reaches the server. The token itself is the
 * same signed JWT the cookie carried, it is still verified by GoTrue, and it
 * is still handed to PostgREST as the caller's identity, so every Row Level
 * Security policy applies exactly as before. Nothing here grants access that
 * a cookie session would not have granted.
 */

/** The bearer token on this request, or null when there is no usable one. */
export async function bearerToken(): Promise<string | null> {
  const value = (await headers()).get("authorization");
  if (!value) return null;

  // Case-insensitive scheme, single space, non-empty token.
  const match = /^Bearer[ ]+(.+)$/i.exec(value.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * A Supabase client that authenticates with `token` instead of cookies.
 *
 * Cookie handling is inert by design: there is no cookie jar to read on a
 * bearer request, and a refreshed token must travel back in the response body
 * rather than a Set-Cookie the WebView would drop. The client is therefore
 * created with session persistence off — the caller owns the session, and the
 * server treats the token as a read-only credential for this one request.
 */
export function createBearerClient(token: string) {
  const { url, key } = supabaseEnv();

  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
