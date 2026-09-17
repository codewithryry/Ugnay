"use client";

/**
 * The native layer, and the small number of places the app has to know it is
 * running inside the APK rather than a browser tab.
 *
 * Everything here is a no-op on the web. The Capacitor packages are real
 * dependencies, so they import cleanly in both builds; `isNative` is what
 * decides whether any of it does anything.
 */

import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

/** True only inside the Android (or iOS) shell. */
export const isNative = () => Capacitor.isNativePlatform();

/**
 * The custom scheme Supabase redirects back to after Google sign-in.
 *
 * OAuth cannot complete inside the app's own WebView: Google refuses to render
 * its consent screen there, and the bundled UI has no origin Supabase could
 * redirect to anyway. The sign-in therefore opens in the system browser, and
 * this scheme is how the result gets back into the app.
 *
 * It must match the intent filter in AndroidManifest.xml and be listed as a
 * Redirect URL in the Supabase dashboard.
 */
export const DEEP_LINK_SCHEME = "com.ugnayai.app";
export const OAUTH_REDIRECT = `${DEEP_LINK_SCHEME}://auth-callback`;

/**
 * Opens an OAuth consent flow in the system browser.
 *
 * The system browser is deliberate, not a fallback: it is the only place the
 * provider will accept the sign-in, and it lets the user see the real URL and
 * padlock before typing a password — which an in-app WebView cannot offer.
 */
export async function openOAuth(url: string) {
  await Browser.open({ url, presentationStyle: "fullscreen" });
}

/** Closes the OAuth browser once the deep link has brought the session back. */
export async function closeOAuth() {
  try {
    await Browser.close();
  } catch {
    // Already closed by the user, which is a normal way to finish.
  }
}

/**
 * Hardware back button.
 *
 * Android's back button does nothing by default in a WebView app, which makes
 * the app feel broken. This maps it onto the app's own history, and only exits
 * when there is nowhere left to go back to — the behaviour a phone user
 * expects from every other app on the device.
 *
 * `onBack` lets the caller intercept first, so an open sidebar or modal closes
 * instead of navigating away.
 */
export function registerBackButton(onBack: () => boolean) {
  if (!isNative()) return () => {};

  const handle = App.addListener("backButton", ({ canGoBack }) => {
    // The caller handled it (closed a sheet, a modal, the sidebar).
    if (onBack()) return;

    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });

  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}

/**
 * Deep links back into the app, which is how an OAuth sign-in finishes.
 *
 * Supabase sends the tokens in the URL fragment of the redirect. The handler
 * hands the whole URL to the caller, which passes it to the Supabase client to
 * establish the session.
 */
export function registerDeepLinks(onUrl: (url: string) => void) {
  if (!isNative()) return () => {};

  const handle = App.addListener("appUrlOpen", ({ url }) => onUrl(url));

  return () => {
    handle.then((h) => h.remove()).catch(() => {});
  };
}

/**
 * Dismisses the launch screen and matches the status bar to the app.
 *
 * The splash is configured not to hide on a timer, because a timer either
 * covers a ready app or uncovers an unready one. This is called once the UI
 * has actually painted, so the handover happens at the right moment.
 */
export async function finishLaunch() {
  if (!isNative()) return;

  try {
    // The app's canvas is dark in both themes, so light content is correct.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0a0a0b" });
  } catch {
    // Not fatal: a device that refuses the style still runs the app.
  }

  try {
    await SplashScreen.hide();
  } catch {
    // Already hidden.
  }
}
