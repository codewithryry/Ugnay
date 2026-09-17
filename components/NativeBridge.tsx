"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  closeOAuth,
  finishLaunch,
  isNative,
  registerBackButton,
  registerDeepLinks,
} from "@/lib/native";

/**
 * Native behaviour for the Android shell. Renders nothing, does nothing on the
 * web, and is mounted once from the root layout.
 *
 * Two jobs: make the hardware back button behave like every other Android app,
 * and finish an OAuth sign-in that comes back through a deep link.
 */
export default function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNative()) return;

    // The shell is mounted and painting, so the launch screen can go.
    finishLaunch();

    const stopBack = registerBackButton(() => {
      // An open overlay closes first. The app dispatches this so the sidebar,
      // modals and the search overlay can claim the press before it becomes a
      // navigation — Escape is what they already listen for.
      const overlay = document.querySelector<HTMLElement>("[data-native-dismiss]");
      if (overlay) {
        overlay.dispatchEvent(new CustomEvent("native-dismiss", { bubbles: true }));
        return true;
      }
      return false;
    });

    const stopLinks = registerDeepLinks(async (url) => {
      // Supabase returns either `?code=` (PKCE) or a `#access_token=` fragment
      // depending on the flow. Both are handled, so a change in Supabase's
      // defaults does not silently break sign-in.
      try {
        const parsed = new URL(url);
        const supabase = createClient();

        const code = parsed.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
          const access_token = fragment.get("access_token");
          const refresh_token = fragment.get("refresh_token");
          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) throw error;
          }
        }

        await closeOAuth();
        // The gate re-reads the session on an auth change, but the router also
        // has to leave /login for the page the user was heading to.
        router.replace("/");
      } catch (error) {
        console.error("[ugnay] Could not complete sign-in from the deep link:", error);
        await closeOAuth();
        router.replace("/login?error=auth");
      }
    });

    return () => {
      stopBack();
      stopLinks();
    };
  }, [router]);

  return null;
}
