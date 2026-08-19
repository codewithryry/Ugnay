/**
 * Greetings for the empty-chat screen. Some are time-aware, some are neutral,
 * and only some use the user's name — so the screen feels varied rather than
 * templated. The last pick is remembered so the same line never appears twice
 * in a row.
 */

export type DayPart = "morning" | "afternoon" | "evening" | "night";

interface Line {
  text: string;
  /** Omitted means the line fits any hour. */
  when?: DayPart;
  /** True when `{name}` is required rather than optional. */
  needsName?: boolean;
}

const HEADLINES: Line[] = [
  // Time-aware, with and without a name.
  { text: "Good morning, {name}", when: "morning", needsName: true },
  { text: "Good morning", when: "morning" },
  { text: "Morning, {name}", when: "morning", needsName: true },
  { text: "Good afternoon, {name}", when: "afternoon", needsName: true },
  { text: "Good afternoon", when: "afternoon" },
  { text: "Good evening, {name}", when: "evening", needsName: true },
  { text: "Good evening", when: "evening" },
  { text: "Still up, {name}?", when: "night", needsName: true },
  { text: "Late one tonight", when: "night" },

  // Any time of day.
  { text: "Hello, {name}", needsName: true },
  { text: "Hey, {name}", needsName: true },
  { text: "Welcome back, {name}", needsName: true },
  { text: "Ready when you are, {name}", needsName: true },
  { text: "Ready when you are" },
  { text: "What’s on your mind?" },
  { text: "What are we working on?" },
  { text: "Where should we start?" },
  { text: "What can I help with?" },
  { text: "Ask me anything" },
  { text: "Let’s get into it" },
];

const SUBTITLES: Line[] = [
  { text: "What’s on your mind?" },
  { text: "What are we working on today?" },
  { text: "Where should we start?" },
  { text: "What are we building?" },
  { text: "Ask anything — I’ll keep it short unless you want detail." },
  { text: "Type a message to begin." },
  { text: "Pick a model below and start typing." },
  { text: "Ready when you are." },
  { text: "How can I help?" },
  { text: "Let’s figure it out together." },
];

export function dayPartFor(hour: number): DayPart {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}

/** Picks one line, never the same as `previous`, and fills in `{name}`. */
function pick(lines: Line[], part: DayPart, name: string, previous: string | null) {
  const eligible = lines.filter(
    (line) => (!line.when || line.when === part) && (!line.needsName || Boolean(name)),
  );
  const fresh = eligible.filter((line) => line.text !== previous);
  const pool = fresh.length ? fresh : eligible;
  const line = pool[Math.floor(Math.random() * pool.length)];
  return {
    key: line.text,
    text: line.text.replace("{name}", name),
  };
}

export interface Greeting {
  headline: string;
  subtitle: string;
  /** Template keys of this pick, to pass back as `previous` next time. */
  keys: { headline: string; subtitle: string };
}

/**
 * Builds a greeting for the given hour and name. Pass the previous pick's keys
 * to guarantee neither line repeats consecutively.
 */
export function pickGreeting({
  hour,
  name,
  previous,
}: {
  hour: number;
  name: string;
  previous?: { headline: string; subtitle: string } | null;
}): Greeting {
  const part = dayPartFor(hour);
  const headline = pick(HEADLINES, part, name, previous?.headline ?? null);
  const subtitle = pick(SUBTITLES, part, name, previous?.subtitle ?? null);

  return {
    headline: headline.text,
    subtitle: subtitle.text,
    keys: { headline: headline.key, subtitle: subtitle.key },
  };
}

export const GREETING_STORAGE_KEY = "ugnay-last-greeting";
