/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /*
   * `next build` normally wipes and rewrites the same .next directory the dev
   * server is serving from, which makes the running page reference chunks that
   * no longer exist (intermittent 404s on /_next/static/**). Setting
   * NEXT_DIST_DIR gives a build its own output directory, so a verification
   * build can never disturb a live dev server. Unset — as on Vercel and in
   * production — this stays the default ".next".
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
