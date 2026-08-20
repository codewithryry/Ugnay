export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type DateGroup = "Today" | "Yesterday" | "Previous 7 Days" | "Older";

const GROUP_ORDER: DateGroup[] = ["Today", "Yesterday", "Previous 7 Days", "Older"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dateGroupOf(iso: string, now = new Date()): DateGroup {
  const today = startOfDay(now);
  const day = startOfDay(new Date(iso));
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 Days";
  return "Older";
}

/** Groups items (newest first) into the labelled buckets the sidebar renders. */
export function groupByDate<T>(items: T[], getDate: (item: T) => string) {
  const buckets = new Map<DateGroup, T[]>();
  for (const item of items) {
    const group = dateGroupOf(getDate(item));
    const list = buckets.get(group) ?? [];
    list.push(item);
    buckets.set(group, list);
  }
  return GROUP_ORDER.filter((g) => buckets.get(g)?.length).map((g) => ({
    label: g,
    items: buckets.get(g)!,
  }));
}

/** Longest title the sidebar shows comfortably. */
const TITLE_LIMIT = 48;
/** The placeholder a chat carries until a real title is generated. */
export const DEFAULT_CHAT_TITLE = "New chat";

/** Openings that carry no topic, so naming a chat after them is misleading. */
const SMALL_TALK =
  /^(hi+|hey+|hello+|yo|sup|hiya|howdy|good (morning|afternoon|evening|day)|thanks?|thank you|ty|ok(ay)?|test(ing)?|ping|are you there)[\s!.,?]*$/i;

/** True when a message is too short or too generic to name a chat after. */
export function isSmallTalk(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length < 4 || SMALL_TALK.test(clean);
}

/** Derives a chat title from the first user message. Fallback only: a title is
 * normally summarised by the model from the first exchange. */
export function titleFromMessage(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || isSmallTalk(clean)) return DEFAULT_CHAT_TITLE;
  return clean.length > TITLE_LIMIT ? `${clean.slice(0, TITLE_LIMIT).trimEnd()}…` : clean;
}

/**
 * Cleans a model-written title into a single short line, or returns null when
 * the model answered with something unusable (a refusal, a whole paragraph).
 */
export function normalizeTitle(raw: string): string | null {
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;

  const clean = line
    .replace(/^(title|chat title)\s*[:\-–]\s*/i, "")
    .replace(/^[#*>\s]+/, "")
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!]+$/, "")
    .trim();

  // A sentence-length answer means the model ignored the instruction.
  if (!clean || clean.length > 80) return null;
  return clean.length > TITLE_LIMIT ? `${clean.slice(0, TITLE_LIMIT).trimEnd()}…` : clean;
}
