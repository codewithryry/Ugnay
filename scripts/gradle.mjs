/**
 * Runs a Gradle task in android/, picking the right wrapper for the platform.
 *
 * `gradlew.bat` only exists for Windows and `./gradlew` only runs on a Unix
 * shell, so hardcoding either breaks the other. CI is Linux and the usual
 * development machine here is Windows, and both have to work.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "android");

if (!existsSync(android)) {
  console.error(
    "android/ is missing. Run `npx cap add android` first — it is generated, " +
      "not checked in.",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const wrapper = join(android, isWindows ? "gradlew.bat" : "gradlew");

if (!existsSync(wrapper)) {
  console.error(`Gradle wrapper not found at ${wrapper}.`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/gradle.mjs <task> [...args]");
  process.exit(1);
}

const result = spawnSync(wrapper, args, {
  cwd: android,
  stdio: "inherit",
  shell: isWindows,
});

process.exit(result.status ?? 1);
