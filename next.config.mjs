const isProduction = process.env.NODE_ENV === "production";

/**
 * Origins the browser is allowed to talk to. Supabase is the only external one:
 * auth, the database and the realtime socket all live on the project URL. Every
 * AI provider is called from the server, so none of them belong here.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseSocket = supabaseOrigin.replace(/^https:/, "wss:");

/**
 * Static export for the Android build.
 *
 * `next build` with this set emits plain HTML/JS into `out/`, which is what
 * Capacitor copies into the APK. It drops the server half of the app — route
 * handlers, middleware and the two server-rendered pages — so it is only ever
 * used for the Android bundle. The deployed web build leaves it unset and is
 * unchanged, server and all.
 */
const isAndroidExport = process.env.BUILD_TARGET === "android";

/**
 * The deployed API the Android bundle calls. Also allowed in connect-src, so a
 * browser opening a non-Android build against a remote API is not blocked.
 */
const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";

/**
 * Script and style sources still need 'unsafe-inline': Next injects inline
 * hydration scripts, the layout runs an inline script to apply the saved theme
 * before first paint, and Tailwind plus the syntax highlighter emit inline
 * styles. Tightening this to a nonce means making every page dynamic, so it is
 * deliberately left for a later change.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Synthesised speech is played back from a blob URL.
  "media-src 'self' blob:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}${apiOrigin ? ` ${apiOrigin}` : ""}${isProduction ? "" : " ws: http://localhost:*"}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Clickjacking protection. Ugnay is never meant to be framed.
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Kept alongside CSP frame-ancestors for browsers that predate it.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Dictation needs the microphone on this origin; nothing else is used.
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Drops the X-Powered-By: Next.js banner.
  poweredByHeader: false,
  /**
   * Emits .next/standalone: a self-contained server with only the packages the
   * build actually traced, which is what the Dockerfile copies into the final
   * image instead of the whole node_modules tree. Ignored by `next dev` and by
   * `next start`, so local development is unaffected.
   */
  // "export" for the Android bundle; "standalone" is what the Dockerfile and
  // the Vercel deployment expect, and stays the default.
  output: isAndroidExport ? "export" : "standalone",
  /**
   * The exported bundle is loaded from a file:// style origin inside the APK,
   * where Next's default image optimiser (a server feature) cannot run.
   */
  ...(isAndroidExport ? { images: { unoptimized: true } } : {}),
  experimental: {
    /**
     * Client-side Router Cache for dynamic pages. The default (0) refetches
     * the whole tree on every visit, which waits on Supabase twice per
     * navigation. A short window makes back-and-forth movement between the
     * app routes render from the last payload instead. Auth transitions call
     * router.refresh(), which invalidates this cache, so a sign-in or
     * sign-out never serves another session's shell.
     */
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
