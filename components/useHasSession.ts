"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Whether this browser holds a session.
 *
 * For the public pages (/terms, /privacy, /faq), which are reachable signed out
 * and link to routes that are not: a guest should not be offered a link that
 * only redirects them to sign-in. Reads the session Supabase already keeps in
 * the browser, so there is no extra round trip, and follows sign-in/sign-out
 * while the page stays open.
 *
 * Null until the first read resolves. Callers treat that as "not signed in", so
 * a link that needs an account is never shown and then taken away.
 */
export function useHasSession() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active) setHasSession(Boolean(data.session));
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setHasSession(Boolean(session));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return hasSession;
}
