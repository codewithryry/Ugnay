import { inflateRawSync } from "node:zlib";
import { extensionOf, typeFor, type SupportedType } from "./knowledge-types";

/**
 * Reading a knowledge file's text, and splitting it for embedding.
 *
 * SERVER ONLY: it uses node:zlib to open a .docx, which is a zip. The shared
 * format list lives in ./knowledge-types so the browser can import that without
 * dragging node:zlib into the bundle.
 *
 * Deliberately dependency-free: everything here is either plain text or a
 * format Node can already open.
 */

/** Longest text kept from one file. Beyond this the tail is dropped. */
const MAX_TEXT_CHARS = 400_000;

/** Roughly a page per chunk, with an overlap so a sentence is never cut off. */
const CHUNK_CHARS = 1_400;
const CHUNK_OVERLAP = 180;

/** Chunks embedded per file. A very long document indexes its first N. */
export const MAX_CHUNKS_PER_FILE = 60;

export type { SupportedType };

/** Collapses the whitespace a document dump is full of. */
function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Minimal zip reader: returns one entry's bytes, or null when it is absent.
 *
 * Only what a .docx needs — the central directory is skipped and the local
 * headers are walked instead, handling the two compression methods Word emits
 * (0 = stored, 8 = deflate).
 */
function readZipEntry(buffer: Buffer, wanted: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    // Local file header signature.
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const dataStart = nameStart + nameLength + extraLength;

    // A streamed entry declares its size in a trailing descriptor, so the
    // length here is zero and the entry cannot be walked past. Rare from Word.
    if (compressedSize === 0 && method !== 0) return null;

    if (name === wanted) {
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

/** Turns WordprocessingML into readable text: one line per paragraph. */
function docxToText(xml: string) {
  return tidy(
    xml
      // Tabs and breaks first, while the markup still marks them.
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      // Cells before paragraphs: a cell's text sits in a <w:p>, so handling
      // </w:p> first would end the line inside the cell and leave the column
      // separator stranded on the next one.
      .replace(/<\/w:p>\s*(?=<\/w:tc>)/g, "")
      .replace(/<\/w:tc>/g, "\t")
      // A row, or a paragraph outside a table, ends a line.
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      // Everything else is structure; the text lives in <w:t> runs.
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      // The last cell of a row leaves a separator with nothing after it.
      .replace(/\t+(\n|$)/g, "$1"),
  );
}

export interface Extraction {
  text: string;
  /** Set when the format is known but its text could not be read. */
  error: string | null;
}

/**
 * Reads a file's text. Never throws: an unreadable upload still gets stored,
 * with the reason recorded so the UI can say what happened.
 */
export function extractText(name: string, bytes: Buffer): Extraction {
  const type = typeFor(name);
  if (!type) return { text: "", error: "This file type is not supported." };

  if (!type.readable) {
    return {
      text: "",
      error: `${type.label} text cannot be indexed yet, so this file will not be used for answers.`,
    };
  }

  const ext = extensionOf(name);

  if (ext === "docx") {
    try {
      const document = readZipEntry(bytes, "word/document.xml");
      if (!document) {
        return { text: "", error: "This .docx could not be opened. Try re-saving it from Word." };
      }
      const text = docxToText(document.toString("utf8"));
      if (!text) return { text: "", error: "This document has no readable text." };
      return { text, error: null };
    } catch (err) {
      console.error("[ugnay] Could not read a .docx:", err);
      return { text: "", error: "This .docx could not be read." };
    }
  }

  if (ext === "json") {
    const raw = bytes.toString("utf8");
    try {
      // Pretty-printing keeps keys on their own lines, which chunks far better
      // than one minified string.
      return { text: tidy(JSON.stringify(JSON.parse(raw), null, 2)), error: null };
    } catch {
      // Not valid JSON; the raw text is still worth indexing.
      return { text: tidy(raw), error: null };
    }
  }

  const text = tidy(bytes.toString("utf8"));
  if (!text) return { text: "", error: "This file is empty." };
  return { text, error: null };
}

/**
 * Splits text into overlapping chunks, preferring to break at a paragraph or
 * sentence boundary so a passage reads as a whole thought.
 *
 * `chunkText` returns only the chunks that fit under the cap. Use
 * `chunkTextWithTotal` when the caller needs to tell the user that a long
 * document was indexed in part — the cap used to be silent, which made a
 * partly-indexed file look complete.
 */
export function chunkText(text: string): string[] {
  return chunkTextWithTotal(text).chunks;
}

export interface ChunkResult {
  /** The chunks that will be indexed, capped at MAX_CHUNKS_PER_FILE. */
  chunks: string[];
  /** How many chunks the whole text would produce, cap ignored. */
  total: number;
}

export function chunkTextWithTotal(text: string): ChunkResult {
  const chunks = splitAll(text);
  return { chunks: chunks.slice(0, MAX_CHUNKS_PER_FILE), total: chunks.length };
}

/** Every chunk in the text, uncapped. */
function splitAll(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_CHARS, text.length);

    if (end < text.length) {
      // Look for a clean break in the last quarter of the window.
      const window = text.slice(start, end);
      const floor = Math.floor(CHUNK_CHARS * 0.6);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
      );
      if (breakAt > floor) end = start + breakAt + 1;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}
