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

/** Derives a chat title from the first user message. */
export function titleFromMessage(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? `${clean.slice(0, 48).trimEnd()}…` : clean;
}
