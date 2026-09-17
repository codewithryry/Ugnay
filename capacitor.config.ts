import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android packaging for Ugnay.
 *
 * The UI ships inside the APK (built by scripts/build-android-web.mjs into
 * `out/`) and calls the deployed site for everything server-side. Nothing here
 * carries a secret: the AI provider keys stay on the server, and the only
 * credential the app holds is the user's own Supabase session.
 */
const config: CapacitorConfig = {
  appId: "com.ugnayai.app",
  appName: "Ugnay AI",
  webDir: "out",

  /**
   * Serve the bundled UI over https://localhost rather than a custom scheme.
   * The WebView then treats it as a secure context, which the app needs:
   * Supabase stores its session in localStorage, and dictation asks for the
   * microphone — both are refused on an origin the browser considers
   * insecure. It is also the origin the API's CORS allow-list expects.
   */
  server: {
    androidScheme: "https",
  },

  android: {
    /**
     * Cleartext stays off. Every request leaves the app over TLS: the Supabase
     * project and the deployed API are both HTTPS.
     */
    allowMixedContent: false,
    /** Ship a release build unsigned here; CI signs it. */
    buildOptions: {
      releaseType: "APK",
    },
  },

  /**
   * The bundled files are static; there is nothing to fetch on start, so the
   * splash screen hands over as soon as the first paint is ready rather than
   * sitting for a fixed delay.
   */
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#0a0a0b",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0a0a0b",
    },
    Keyboard: {
      /**
       * The composer sits at the bottom of the chat. `native` resizes the
       * WebView itself when the keyboard opens, which keeps the input and its
       * send button above the keyboard instead of behind it.
       */
      resize: "native",
    },
  },
};

export default config;
