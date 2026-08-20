import type { ProviderMessage } from "@/lib/providers";

/**
 * Baseline behaviour every reply starts from: read what the user meant, not just
 * what they typed. Kept compact because it is sent with every request, and
 * placed first so the user's own instructions can still override it.
 */
export const BASE_INSTRUCTIONS = [
  "Interpret the user's intent generously. Prompts may contain typos, misspellings,",
  "missing words, shorthand or loose grammar — infer the intended meaning from the",
  "wording and the conversation so far, and answer that.",
  "Users write in English, Filipino or Taglish, sometimes mixing them mid-sentence;",
  "handle all three naturally and reply in the language the user is using.",
  "Never correct, rewrite or comment on their spelling or grammar unless they ask,",
  "and do not restate the prompt back to them before answering.",
  "When the intent is reasonably clear, answer directly instead of asking them to rephrase.",
  "Only when a prompt is genuinely ambiguous — where different readings would lead to",
  "materially different answers — ask one short clarifying question instead of guessing.",
].join(" ");

/**
 * Hard limits for the turn, derived from the Composer toggles. Only the *off*
 * states are stated: a model that would otherwise reason or reach for a web
 * tool on its own must not do so when the user has not enabled it. Appended
 * after the user's own instructions so they cannot override it.
 */
export function composeCapabilityInstructions(caps: {
  thinking: boolean;
  webSearch: boolean;
}): string | null {
  const lines: string[] = [];
  if (!caps.thinking) {
    lines.push(
      "Thinking is off for this turn: do not reason step by step, do not deliberate or plan",
      "out loud, and do not emit any thinking, reasoning or analysis section. Answer directly.",
    );
  }
  if (!caps.webSearch) {
    lines.push(
      "Web search is off for this turn: you have no web, browsing or search access and no tool",
      "to reach it. Do not search, fetch or claim to have looked anything up; answer from what",
      "you already know, and say plainly when something may be out of date.",
    );
  }
  return lines.length ? lines.join(" ") : null;
}

/**
 * Combines the baseline instructions with the persistent global system prompt
 * and the per-chat override. The per-chat instruction is appended before the
 * capability limits, so it wins on conflicts with the other prompts but not
 * over the toggles, and a single system message is emitted for provider
 * portability.
 */
export function composeSystemPrompt(
  globalPrompt: string | null | undefined,
  chatPrompt: string | null | undefined,
  capabilityInstructions?: string | null,
): string | null {
  const parts: string[] = [BASE_INSTRUCTIONS];
  const g = globalPrompt?.trim();
  const c = chatPrompt?.trim();
  if (g) parts.push(g);
  if (c) parts.push(`Instructions for this conversation specifically:\n${c}`);
  const caps = capabilityInstructions?.trim();
  if (caps) parts.push(caps);
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Renders a compact digest of the user's earlier conversations for the system
 * prompt. Only ever called with rows already scoped to one user.
 */
export function composeHistoryContext(
  conversations: { title: string; updated_at: string; excerpt: string }[],
): string | null {
  if (conversations.length === 0) return null;
  const lines = conversations.map(
    (c) => `- ${c.title} (${c.updated_at.slice(0, 10)}): ${c.excerpt}`,
  );
  return [
    "Context from this user's earlier conversations with you. Use it only when it is",
    "relevant to the current question, and never mention this list verbatim:",
    ...lines,
  ].join("\n");
}

export function withSystemPrompt(
  messages: ProviderMessage[],
  systemPrompt: string | null,
): ProviderMessage[] {
  const body = messages.filter((m) => m.role !== "system");
  return systemPrompt ? [{ role: "system", content: systemPrompt }, ...body] : body;
}

/**
 * Prompt for the short title pass that runs once, after a chat's first
 * exchange. Written strictly because a model left to itself tends to echo the
 * user's opening line back as the title.
 */
export function composeTitleMessages(
  userMessage: string,
  assistantMessage: string,
): ProviderMessage[] {
  return [
    {
      role: "system",
      content: [
        "You name chat conversations. Read the exchange and reply with a title for it —",
        "nothing else: no quotes, no punctuation at the end, no explanation.",
        "Summarise the topic or what the user is trying to do, in 2 to 6 words,",
        "in Title Case, in the language the user is writing in.",
        "Never copy the user's sentence verbatim, and never keep greetings, filler,",
        "typos or question wording — describe the subject instead.",
        'Example: "why i got this error 17:35??" → "Troubleshooting Error 17:35".',
        'Example: "hi try this model" → "Trying A New Model".',
        'If the exchange has no identifiable topic, reply with exactly: New chat.',
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `User: ${userMessage.replace(/\s+/g, " ").slice(0, 1200)}`,
        `Assistant: ${assistantMessage.replace(/\s+/g, " ").slice(0, 1200)}`,
      ].join("\n"),
    },
  ];
}
