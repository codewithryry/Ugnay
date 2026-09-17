import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { bearerToken, createBearerClient } from "./bearer";
import { supabaseEnv } from "./env";

/**
 * Request-scoped Supabase client for Server Components, Route Handlers and
 * Actions. Async because Next 15 resolves `cookies()` asynchronously.
 *
 * Two callers, one identity model. A browser on this origin authenticates with
 * cookies; the Android app, whose WebView cannot send them cross-origin, sends
 * `Authorization: Bearer <access_token>` instead. A bearer token wins when one
 * is present, because only a non-browser caller sends it deliberately.
 *
 * Both paths end up with the caller's own JWT attached to every PostgREST
 * request, so Row Level Security is enforced identically either way. This is a
 * change of transport, not of trust.
 */
export async function createClient() {
  const token = await bearerToken();
  if (token) return createBearerClient(token);

  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(items: { name: string; value: string; options: CookieOptions }[]) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}
