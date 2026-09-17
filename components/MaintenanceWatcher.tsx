"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/api";

/** Poll interval, both ways. Slow on purpose: this is a background check. */
const EVERY_MS = 30_000;

/**
 * Keeps a tab in step with the site switch without anyone refreshing.
 *
 * `offline` is what this page was rendered for. When the server disagrees the
 * tab reloads — the maintenance screen leaves for Ugnay, and an open app
 * reloads its own URL so the middleware decides where it belongs (an admin
 * stays put; everyone else lands on the maintenance screen).
 */
export default function MaintenanceWatcher({
  offline = false,
  pause = false,
}: {
  offline?: boolean;
  /** Held off while a reply is streaming, so nothing interrupts a turn. */
  pause?: boolean;
}) {
  useEffect(() => {
    if (pause) return;
    const timer = setInterval(async () => {
      // A hidden tab neither needs the check nor should pay for it.
      if (document.visibilityState !== "visible") return;
      try {
        const res = await apiFetch("/api/maintenance", { cache: "no-store" });
        if (!res.ok) return;
        const { maintenance } = await res.json();
        if (Boolean(maintenance) === offline) return;
        window.location.assign(offline ? "/" : window.location.pathname);
      } catch {
        // Offline or a hiccup; the next tick tries again.
      }
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [offline, pause]);

  return null;
}
