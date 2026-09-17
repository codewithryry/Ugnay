"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CurrentUserRecord } from "@/lib/current-user";

/**
 * The session gate for the Android build.
 *
 * On the web, `getCurrentUser()` runs on the server and the middleware
 * redirects a signed-out visitor before the page renders. The exported bundle
 * has neither, so the same two decisions — who is this, and may they be here —
 * have to happen in the browser, after the JS loads.
 *
 * This is not a weakening of the gate. The server-side check still guards the
 * data: every API route and every Row Level Security policy re-resolves the
 * user from their token on each request. What this component decides is only
 * what to *render*, which is a UI concern. A visitor who defeated it would see
 * an empty shell whose every request still came back 401.
 */

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; user: CurrentUserRecord };

export default function ClientUserGate({
  children,
  fallback,
  /** Renders instead of redirecting when signed out, as the chat landing does. */
  signedOut,
}: {
  children: (user: CurrentUserRecord) => React.ReactNode;
  fallback?: React.ReactNode;
  signedOut?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function resolve() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;
      if (!user) {
        setState({ status: "signed-out" });
        return;
      }

      // Mirrors the columns getCurrentUser() reads, so ChatApp receives the
      // same shape whether the server or the browser resolved it.
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, nickname, avatar_url, email")
        .eq("id", user.id)
        .maybeSingle();

      if (!active) return;

      const metadata = user.user_metadata ?? {};
      setState({
        status: "ready",
        user: {
          userId: user.id,
          email: profile?.email ?? user.email ?? "",
          displayName:
            profile?.display_name ?? user.email?.split("@")[0] ?? "You",
          avatarUrl:
            profile?.avatar_url ??
            (metadata.avatar_url as string) ??
            (metadata.picture as string) ??
            null,
          nickname: profile?.nickname ?? null,
          createdAt: user.created_at,
        },
      });
    }

    resolve();

    // A sign-in or sign-out anywhere in the app re-runs the gate, so the shell
    // never keeps rendering the previous session's view.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => resolve());

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Only redirect when the caller has no signed-out view of its own.
    if (state.status === "signed-out" && !signedOut) router.replace("/login");
  }, [state.status, signedOut, router]);

  if (state.status === "loading") {
    return (
      fallback ?? (
        <div
          className="flex min-h-dvh items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <span className="sr-only">Loading Ugnay…</span>
          <div
            aria-hidden
            className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80"
          />
        </div>
      )
    );
  }

  if (state.status === "signed-out") return <>{signedOut ?? null}</>;

  return <>{children(state.user)}</>;
}
