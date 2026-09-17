/**
 * Builds the static web bundle that ships inside the Android APK.
 *
 * `output: "export"` refuses to build anything that needs a server, and this
 * app has plenty: 21 route handlers, the middleware auth gate, the OAuth code
 * exchange, the admin dashboard and two pages that read the session while
 * rendering. None of that belongs in the APK anyway — the app calls the
 * deployed site for all of it.
 *
 * Those files are part of the production web app, so the build does not delete
 * them. It builds from a disposable copy of the project instead: the source
 * tree is never modified, which means an interrupted build cannot leave it
 * half-dismantled. (An earlier version moved files aside and put them back;
 * that lost to OneDrive, which locks directories mid-rename on Windows.)
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, ".android-build");

/** Server-only paths, left out of the copy. */
const SERVER_ONLY = [
  "app/api",
  "middleware.ts",
  // The OAuth code exchange runs on the deployed site, which is where
  // Supabase redirects; the app returns from the browser via a deep link.
  "app/auth",
  // Server-rendered: /maintenance reads the settings row and /s/[slug] renders
  // a shared conversation. Neither is part of the app's own navigation.
  "app/maintenance",
  "app/s",
  // A generated route needing a server. The APK has its own native manifest.
  "app/manifest.ts",
  // A desktop management surface, rendered per request. Not the mobile app.
  "app/admin",
];

/**
 * Pages replaced for the export.
 *
 * Each is a thin server wrapper that resolves the session from cookies and
 * hands it to a client component. The replacement renders the same component
 * behind ClientUserGate, which resolves the session in the browser instead.
 */
const PAGE_SWAPS = [
  ["app/(chat)/page.tsx", "chat.tsx"],
  ["app/knowledge/page.tsx", "knowledge.tsx"],
  ["app/search/page.tsx", "search.tsx"],
  ["app/workflows/page.tsx", "workflows.tsx"],
  ["app/credits/page.tsx", "credits.tsx"],
  ["app/feedback/page.tsx", "feedback.tsx"],
  ["app/release-notes/page.tsx", "release-notes.tsx"],
];

/** Copied into the build; everything else (.next, out, android, .git) is not. */
const SOURCE = ["app", "components", "lib", "store", "types", "public", "supabase"];
const FILES = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "postcss.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
  "next-env.d.ts",
];

/**
 * Reads a public build value from the environment, falling back to the
 * project's env files. CI passes these as environment variables; a local build
 * normally has them in .env.local or .env, which Next itself would read were
 * the build not running from a copy of the project.
 */
function readEnv(name) {
  if (process.env[name]) return process.env[name].trim();

  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const match = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(path, "utf8"));
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }

  return "";
}

const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;
if (!apiOrigin) {
  console.error(
    "NEXT_PUBLIC_API_ORIGIN is required for the Android build: it is the deployed\n" +
      "site the app calls for chat, knowledge and everything else server-side.\n" +
      "Example: NEXT_PUBLIC_API_ORIGIN=https://ugnayai.vercel.app npm run build:android:web",
  );
  process.exit(1);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const skip = new Set(SERVER_ONLY.map((p) => join(work, p)));

for (const dir of SOURCE) {
  const from = join(root, dir);
  if (!existsSync(from)) continue;
  cpSync(from, join(work, dir), {
    recursive: true,
    // Server-only paths are dropped as the tree is copied, so they never
    // exist in the build at all.
    filter: (src) => {
      const rel = join(work, src.slice(root.length + 1));
      return !skip.has(rel);
    },
  });
}

for (const file of FILES) {
  const from = join(root, file);
  if (existsSync(from)) cpSync(from, join(work, file));
}

// Any stray server-only file the filter did not catch (a bare file rather
// than a directory) is removed here.
for (const rel of SERVER_ONLY) rmSync(join(work, rel), { recursive: true, force: true });

for (const [rel, replacement] of PAGE_SWAPS) {
  const target = join(work, rel);
  if (!existsSync(dirname(target))) continue;
  cpSync(join(root, "scripts", "android-pages", replacement), target);
}

// node_modules is linked rather than copied: it is large, and the build only
// reads from it. A junction works without Developer Mode on Windows.
const modules = join(work, "node_modules");
if (!existsSync(modules)) {
  const link = spawnSync(
    process.platform === "win32" ? "cmd" : "ln",
    process.platform === "win32"
      ? ["/c", "mklink", "/J", modules, join(root, "node_modules")]
      : ["-s", join(root, "node_modules"), modules],
    { stdio: "ignore" },
  );
  // A junction is an optimisation, not a requirement.
  if (link.status !== 0) cpSync(join(root, "node_modules"), modules, { recursive: true });
}

/**
 * The public values Next inlines into the bundle at build time.
 *
 * These must be written into the build directory explicitly. The build runs in
 * a copy of the project, so the root `.env` is not beside it, and Next would
 * otherwise leave `process.env.NEXT_PUBLIC_SUPABASE_URL` in the output as an
 * unreplaced identifier — which throws inside the APK the moment the Supabase
 * client is constructed, i.e. on the sign-in screen.
 *
 * All of these are public by definition. The Supabase URL and publishable key
 * are the same values the web app already serves to every browser; Row Level
 * Security, not their secrecy, is what protects the data.
 */
const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseKey = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", supabaseUrl],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", supabaseKey],
].filter(([, value]) => !value);

if (missing.length > 0) {
  console.error(
    `Missing ${missing.map(([name]) => name).join(" and ")}.\n` +
      "The Android bundle inlines these at build time; without them the app throws\n" +
      "on launch instead of showing the sign-in screen.\n" +
      "Set them in .env / .env.local, or as environment variables in CI.",
  );
  process.exit(1);
}

// The export has no server to apply next.config headers, and Next warns about
// it on every build. The CSP is served by the deployed site for the web app;
// inside the APK the WebView enforces its own origin rules.
writeFileSync(
  join(work, ".env.production"),
  [
    `NEXT_PUBLIC_API_ORIGIN=${apiOrigin}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${supabaseKey}`,
    // Canonical and Open Graph URLs point at the real site, not localhost.
    `NEXT_PUBLIC_SITE_URL=${apiOrigin}`,
    "",
  ].join("\n"),
  "utf8",
);

const result = spawnSync("npx", ["next", "build"], {
  cwd: work,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    BUILD_TARGET: "android",
    NEXT_PUBLIC_API_ORIGIN: apiOrigin,
  },
});

if (result.status !== 0) {
  console.error("\nThe Android web build failed. The source tree was not modified.");
  process.exit(result.status ?? 1);
}

// Hand the export to Capacitor at the path capacitor.config.ts expects.
const out = join(root, "out");
rmSync(out, { recursive: true, force: true });
cpSync(join(work, "out"), out, { recursive: true });

console.log(`\nAndroid web bundle ready in out/ (${readdirSync(out).length} entries).`);
console.log(`API origin: ${apiOrigin}`);
