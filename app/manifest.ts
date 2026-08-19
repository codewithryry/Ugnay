import type { MetadataRoute } from "next";

/**
 * Installable-app metadata. `standalone` gives the installed app its own
 * window; `start_url` is the chat surface, which redirects to /login when
 * there is no session, exactly as the browser tab does.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ugnay",
    short_name: "Ugnay",
    description:
      "Ugnay is a fast, minimal AI chat app: talk to multiple AI models in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    icons: [
      // Sizes are the real pixel dimensions of each file (derived from Logo.png).
      { src: "/logo/logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo/logo-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
      { src: "/logo/logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo/logo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
