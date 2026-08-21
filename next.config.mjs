const isProduction = process.env.NODE_ENV === "production";

/**
 * Origins the browser is allowed to talk to. Supabase is the only external one:
 * auth, the database and the realtime socket all live on the project URL. Every
 * AI provider is called from the server, so none of them belong here.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseSocket = supabaseOrigin.replace(/^https:/, "wss:");

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
  `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}${isProduction ? "" : " ws: http://localhost:*"}`,
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
