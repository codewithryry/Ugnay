"use client";

import { useEffect, useState } from "react";

/**
 * True on the phone-sized and installed-app (PWA) experience.
 *
 * The width half of the query is Tailwind's `md` breakpoint, so this stays in
 * step with the `md:` classes the rest of the app lays out with. The
 * `display-mode` half catches the installed app, which runs standalone and
 * should get the compact treatment whatever the window happens to measure.
 *
 * Starts `false` so the server render and the first client render agree; the
 * effect corrects it before paint.
 */
export const COMPACT_QUERY = "(max-width: 767px), (display-mode: standalone)";

export function useIsCompact() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    setCompact(media.matches);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return compact;
}
