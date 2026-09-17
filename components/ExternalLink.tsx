"use client";

import { Browser } from "@capacitor/browser";
import { isNative } from "@/lib/native";

/**
 * A link to somewhere outside Ugnay.
 *
 * On the web this is an ordinary `target="_blank"` anchor and behaves exactly
 * as it always has.
 *
 * Inside the Android app it cannot be. The WebView has no tabs, so
 * `target="_blank"` either does nothing at all or replaces the app's own view
 * with the external page — and because the bundled UI is the only history
 * entry, the back button then has nowhere to return to. Capacitor's Browser
 * opens the system browser instead, which is a separate surface the user can
 * dismiss to come straight back to Ugnay.
 *
 * The anchor is kept in both cases rather than swapped for a button: it stays
 * a real link for the accessibility tree, for "copy link address", and for
 * anyone middle-clicking it on the web.
 */
export default function ExternalLink({
  href,
  className,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        if (!isNative()) return;
        // The WebView would otherwise navigate itself to the external page.
        event.preventDefault();
        Browser.open({ url: href }).catch((error) => {
          console.error("[ugnay] Could not open the external link:", error);
        });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
