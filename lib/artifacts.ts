/**
 * Which generated blocks are worth opening in the canvas.
 *
 * A short snippet reads better inline, so only substantial blocks qualify. The
 * kind decides how the canvas previews it.
 */

export type ArtifactKind = "html" | "markdown" | "json" | "code";

/** Below this a block is a snippet, not a document. */
const MIN_CHARS = 320;
const MIN_LINES = 8;

const HTML_LANGUAGES = new Set(["html", "htm", "xhtml", "svg"]);
const MARKDOWN_LANGUAGES = new Set(["markdown", "md", "mdx"]);
const JSON_LANGUAGES = new Set(["json", "jsonc", "json5"]);

/** Languages that are prose or config rather than something to run. */
const CODE_LANGUAGES = new Set([
  "bash", "c", "cpp", "csharp", "css", "diff", "dockerfile", "go", "graphql",
  "java", "javascript", "js", "jsx", "kotlin", "lua", "php", "python", "py",
  "ruby", "rust", "scss", "shell", "sh", "sql", "swift", "toml", "tsx",
  "typescript", "ts", "xml", "yaml", "yml", "zsh",
]);

export function artifactKind(language: string | undefined): ArtifactKind | null {
  const lang = (language ?? "").toLowerCase();
  if (!lang) return null;
  if (HTML_LANGUAGES.has(lang)) return "html";
  if (MARKDOWN_LANGUAGES.has(lang)) return "markdown";
  if (JSON_LANGUAGES.has(lang)) return "json";
  if (CODE_LANGUAGES.has(lang)) return "code";
  return null;
}

/**
 * True when this block is worth an editable canvas: a recognised language and
 * enough content that a side panel beats reading it inline.
 */
export function isArtifact(language: string | undefined, code: string) {
  if (!artifactKind(language)) return false;
  const text = code.trim();
  if (!text) return false;
  return text.length >= MIN_CHARS || text.split("\n").length >= MIN_LINES;
}

/** A short, human name for the canvas header and the download filename. */
export function artifactTitle(language: string | undefined, code: string) {
  const kind = artifactKind(language);
  if (kind === "html") {
    const title = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(code)?.[1]?.trim();
    if (title) return title;
  }
  if (kind === "markdown") {
    const heading = /^#{1,3}\s+(.{1,80})$/m.exec(code)?.[1]?.trim();
    if (heading) return heading;
  }
  return (language ?? "Document").toUpperCase();
}

/** Extension used when the canvas offers the artifact as a download. */
export function artifactExtension(language: string | undefined) {
  const lang = (language ?? "").toLowerCase();
  const known: Record<string, string> = {
    javascript: "js", typescript: "ts", python: "py", markdown: "md",
    shell: "sh", bash: "sh", csharp: "cs", ruby: "rb", rust: "rs",
    kotlin: "kt", golang: "go", yaml: "yml",
  };
  return known[lang] ?? (lang || "txt");
}

/** Pretty-prints JSON, or reports why it could not be parsed. */
export function formatJson(code: string): { text: string; error: string | null } {
  try {
    return { text: JSON.stringify(JSON.parse(code), null, 2), error: null };
  } catch (err) {
    return { text: code, error: (err as Error).message };
  }
}
