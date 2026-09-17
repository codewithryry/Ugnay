/**
 * Generates the Android launcher icons and splash image from the existing
 * brand logo, so the app carries the same mark as the web app and the PWA.
 *
 * Run after `npx cap add android`, and again whenever the logo changes.
 * Requires `sharp`, which is already a transitive dependency of the build.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "public", "logo", "Logo.png");
const RES = join(root, "android", "app", "src", "main", "res");

/** The background behind the mark, matching the app's own dark canvas. */
const BACKGROUND = "#0a0a0b";

/** Launcher icon sizes per density, as Android expects them. */
const LAUNCHER = [
  ["mipmap-mdpi", 48],
  ["mipmap-hdpi", 72],
  ["mipmap-xhdpi", 96],
  ["mipmap-xxhdpi", 144],
  ["mipmap-xxxhdpi", 192],
];

/**
 * Adaptive-icon foregrounds are larger than the icon and mostly margin:
 * Android crops them to whatever shape the launcher uses (circle, squircle,
 * rounded square), so the mark has to sit well inside the safe zone or its
 * edges are shaved off.
 */
const ADAPTIVE = [
  ["mipmap-mdpi", 108],
  ["mipmap-hdpi", 162],
  ["mipmap-xhdpi", 216],
  ["mipmap-xxhdpi", 324],
  ["mipmap-xxxhdpi", 432],
];

/** Splash images, sized for the densities Android draws them at. */
const SPLASH = [
  ["drawable", 480],
  ["drawable-land-mdpi", 480],
  ["drawable-land-hdpi", 800],
  ["drawable-land-xhdpi", 1280],
  ["drawable-land-xxhdpi", 1600],
  ["drawable-land-xxxhdpi", 1920],
  ["drawable-port-mdpi", 480],
  ["drawable-port-hdpi", 800],
  ["drawable-port-xhdpi", 1280],
  ["drawable-port-xxhdpi", 1600],
  ["drawable-port-xxxhdpi", 1920],
];

async function square(size, inset) {
  const mark = Math.round(size * inset);
  const logo = await sharp(SOURCE).resize(mark, mark, { fit: "contain" }).png().toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
}

async function write(dir, name, buffer) {
  const target = join(RES, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, name), buffer);
}

// Legacy launcher icons. The mark fills most of the tile.
for (const [dir, size] of LAUNCHER) {
  const icon = await square(size, 0.78);
  await write(dir, "ic_launcher.png", icon);
  await write(dir, "ic_launcher_round.png", icon);
}

// Adaptive foregrounds: ~60% of the canvas keeps the mark inside the safe zone
// whatever shape the launcher crops it to.
for (const [dir, size] of ADAPTIVE) {
  const mark = Math.round(size * 0.6);
  const logo = await sharp(SOURCE).resize(mark, mark, { fit: "contain" }).png().toBuffer();
  const foreground = await sharp({
    create: { width: size, height: size, channels: 4, background: "#00000000" },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
  await write(dir, "ic_launcher_foreground.png", foreground);
}

// Splash: the mark centred on the app's background, at a restrained size so it
// reads as a launch screen rather than a full-bleed image.
for (const [dir, size] of SPLASH) {
  const logo = await sharp(SOURCE)
    .resize(Math.round(size * 0.28), Math.round(size * 0.28), { fit: "contain" })
    .png()
    .toBuffer();
  const splash = await sharp({
    create: { width: size, height: size, channels: 4, background: BACKGROUND },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
  await write(dir, "splash.png", splash);
}

// The adaptive icon needs a solid background layer to composite against.
mkdirSync(join(RES, "values"), { recursive: true });
writeFileSync(
  join(RES, "values", "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BACKGROUND}</color>
</resources>
`,
  "utf8",
);

for (const dir of ["mipmap-anydpi-v26"]) {
  mkdirSync(join(RES, dir), { recursive: true });
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  writeFileSync(join(RES, dir, "ic_launcher.xml"), xml, "utf8");
  writeFileSync(join(RES, dir, "ic_launcher_round.xml"), xml, "utf8");
}

console.log("Android launcher icons and splash images generated from public/logo/Logo.png");
