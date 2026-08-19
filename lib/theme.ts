export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "ugnay-theme";

/** Resolves "system" against the OS preference. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Applies a theme by stamping `data-theme` on <html>; every colour token in
 * globals.css keys off that attribute. The choice is mirrored into
 * localStorage so the inline script in the layout can avoid a flash on load —
 * the durable copy lives on the user's settings row.
 */
export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(choice);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked; the attribute above still applies for this session.
  }
}
