"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Where the API lives, and how the browser proves who it is.
 *
 * On the web the answer is "the current origin, with cookies": the page and
 * the route handlers are the same deployment, so a relative URL works and the
 * session cookie rides along untouched.
 *
 * The Android build is served from inside the APK, so there is no origin to be
 * relative to and no cookie that would survive the hop. It calls the deployed
 * site instead, and proves the session with the access token the Supabase
 * client already holds in the WebView's storage.
 *
 * NEXT_PUBLIC_API_ORIGIN is what distinguishes the two. It is inlined at build
 * time: set for the Android bundle, unset for the web build, which therefore
 * keeps its existing same-origin behaviour exactly.
 */
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN ?? "").replace(/\/+$/, "");

/** True when this bundle talks to a different origin than it was served from. */
export const isRemoteApi = API_ORIGIN.length > 0;

/** Absolute URL for an API path, or the path itself on a same-origin build. */
export function apiUrl(path: string): string {
  if (!isRemoteApi) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * `fetch` for this app's own API.
 *
 * Same-origin builds are passed through unchanged, so the web app's behaviour
 * — including cookie auth — is exactly what it was. Cross-origin builds get an
 * absolute URL, an Authorization header carrying the current access token, and
 * `credentials: "omit"`, because sending cookies cross-origin would only
 * trigger the stricter CORS rules for no benefit: the token is the credential.
 *
 * The token is read per call rather than cached. `getSession()` refreshes it
 * when it is close to expiry, so a long-lived app (a chat left open overnight)
 * keeps sending a valid one instead of a stale token the server would reject.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isRemoteApi) return fetch(path, init);

  const headers = new Headers(init.headers);

  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(apiUrl(path), { ...init, headers, credentials: "omit" });
}
