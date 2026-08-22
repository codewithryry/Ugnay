/**
 * The shared half of the knowledge module: which formats are accepted and how
 * their names are read.
 *
 * Separate from lib/knowledge.ts because that one opens a .docx with node:zlib,
 * which cannot be bundled for the browser. Everything here is safe on both
 * sides, so the uploader and the API route describe the same list.
 */

/** Largest upload accepted. Keeps one extraction and its embeddings bounded. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface SupportedType {
  /** Lower-case extension, without the dot. */
  ext: string;
  label: string;
  /** False when the file can be stored but its text cannot be read. */
  readable: boolean;
}

/**
 * Formats the uploader accepts. PDF is listed as unreadable rather than
 * rejected: the original is still stored and downloadable, it simply cannot
 * join the searchable knowledge base, because extracting text from a PDF needs
 * a parser this project does not depend on.
 */
export const SUPPORTED_TYPES: SupportedType[] = [
  { ext: "txt", label: "Plain text", readable: true },
  { ext: "md", label: "Markdown", readable: true },
  { ext: "markdown", label: "Markdown", readable: true },
  { ext: "csv", label: "CSV", readable: true },
  { ext: "tsv", label: "TSV", readable: true },
  { ext: "json", label: "JSON", readable: true },
  { ext: "docx", label: "Word document", readable: true },
  { ext: "pdf", label: "PDF", readable: false },
];

/** The `accept` attribute for the file input, derived from the list above. */
export const ACCEPT_ATTRIBUTE = SUPPORTED_TYPES.map((t) => `.${t.ext}`).join(",");

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function typeFor(name: string) {
  return SUPPORTED_TYPES.find((t) => t.ext === extensionOf(name)) ?? null;
}
