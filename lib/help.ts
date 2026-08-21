/**
 * Content for the Help pages: the FAQ answers and the release history.
 *
 * Both are product copy rather than user data, so they live here beside the
 * other static content modules and are edited in place as Ugnay changes.
 */

export interface FaqItem {
  /** Stable anchor, used by the sidebar links and the deep-link in the URL. */
  id: string;
  question: string;
  answer: string;
}

export interface FaqSection {
  id: string;
  title: string;
  items: FaqItem[];
}

/**
 * The FAQ, grouped the way the page reads it: one nav group per section, one
 * heading per question. Order here is the order on the page.
 */
export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "get-started",
    title: "Get started",
    items: [
      {
        id: "what-is-ugnay",
        question: "What is Ugnay?",
        answer:
          "Ugnay is a minimal AI chat app. You talk to several AI models in one place, and your conversations are saved to your account so you can pick any of them back up later.",
      },
      {
        id: "available-models",
        question: "Which models can I use?",
        answer:
          "Whichever ones the server has keys for. Open the model picker below the composer to see them: the model you are using sits up front, and \"More models\" opens the rest, grouped by provider. Auto routes your message to a suitable free model.",
      },
    ],
  },
  {
    id: "chatting",
    title: "Chatting",
    items: [
      {
        id: "thinking-and-web-search",
        question: "What do Thinking and Web search do?",
        answer:
          "Thinking asks the model to reason for longer before it answers, and shows that reasoning above the reply. Web search lets the model look things up while answering. Both are per-message toggles in the composer, so switching one takes effect on your very next message.",
      },
      {
        id: "conversation-titles",
        question: "How are conversation titles created?",
        answer:
          "After the first exchange, Ugnay summarises what the conversation is about and names it. A chat that is only a greeting keeps the placeholder title until there is a real topic. You can always rename a conversation from its row in the sidebar.",
      },
      {
        id: "temporary-chats",
        question: "Can I chat without saving anything?",
        answer:
          "Yes. Turn on the temporary chat from the chat header: nothing is written to your history, and the transcript is gone as soon as you leave it.",
      },
    ],
  },
  {
    id: "workspaces",
    title: "Workspaces",
    items: [
      {
        id: "what-is-a-workspace",
        question: "What is a workspace?",
        answer:
          "A named folder for conversations, under Projects in the sidebar. Opening one reopens its most recent conversation, and the + beside it starts a new one inside it. Each workspace has its own instructions, sent with every conversation in it. Deleting a workspace keeps its conversations — they move back to History.",
      },
    ],
  },
  {
    id: "your-data",
    title: "Your data",
    items: [
      {
        id: "conversation-memory",
        question: "Does Ugnay remember my earlier conversations?",
        answer:
          "Only if you ask it to. Settings → Data Controls has a switch for personalising replies with your history; while it is off, each conversation is answered on its own.",
      },
      {
        id: "export-data",
        question: "Can I export my data?",
        answer:
          "Yes. Settings → Data Controls exports every conversation as Markdown files in a single archive.",
      },
    ],
  },
  {
    id: "plans-and-billing",
    title: "Plans & billing",
    items: [
      {
        id: "pricing",
        question: "Do I have to pay?",
        answer:
          "No. Ugnay runs on free models by default and the Free plan needs no card. The Upgrade page lists the tiers planned beyond it.",
      },
    ],
  },
  {
    id: "getting-help",
    title: "Getting help",
    items: [
      {
        id: "report-a-problem",
        question: "Something is wrong — how do I report it?",
        answer:
          "Send it from the Feedback page. Bug reports are the most useful thing you can send: what you did, what you expected, and what happened instead.",
      },
    ],
  },
];

export interface ReleaseNote {
  version: string;
  /** ISO date, rendered in the reader's locale. */
  date: string;
  title: string;
  changes: string[];
}

/** Newest first — the page renders them in this order. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.6.0",
    date: "2026-08-21",
    title: "Prompt library, branching, sharing, compare and canvas",
    changes: [
      "Run this release's supabase/schema.sql in the Supabase SQL editor before using the features below. It is idempotent and adds the prompt, sharing and file tables, the workspace and conversation columns, and the sharing and usage functions.",
      "Prompt library: save, edit, organise and search reusable prompts, then drop one into the composer from the Prompts button.",
      "Branch a conversation from any reply. The turns up to that point are copied into a new conversation and the original is left exactly as it was.",
      "Compare models: send one prompt to up to four models at once and read the replies side by side. Nothing from a comparison is saved to your history.",
      "Canvas: substantial generated code, HTML, Markdown and JSON can be opened in an editable panel beside the conversation, with a preview and a download.",
      "Memory controls: see what Ugnay remembers, forget individual items or clear everything, and switch memory off for the whole account or for one workspace.",
      "Share a conversation with a read-only link. It shows a snapshot from the moment you created it, later messages stay private, and you can turn the link off at any time.",
      "Usage: your real message, model and provider totals with the token counts providers reported. No cost is estimated, because Ugnay stores no pricing.",
      "Conversations can be pinned to the top or archived out of the way, and History has its own filter box.",
      "Workspaces gained their own memory switch and preferred model, alongside their instructions.",
      "Keyboard shortcuts: Cmd/Ctrl+K opens search, Cmd/Ctrl+Shift+O starts a new chat, Cmd/Ctrl+Shift+P opens the model picker, and Escape closes whatever is open.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-08-21",
    title: "Security hardening, Next.js 15, and rebuilt help surfaces",
    changes: [
      "Security headers on every response: a content security policy, clickjacking protection, a strict referrer policy, and HSTS in production.",
      "Per-account rate limits on the chat, dictation and speech endpoints, so one account can no longer exhaust a provider.",
      "Oversized messages are rejected before any provider is called, including the replayed turns of a temporary chat.",
      "The sign-in callback only returns you to a configured site URL or a known host, never to one named by the request itself.",
      "Provider failures now read as plain messages — API keys, account identifiers and upstream responses stay in the server log.",
      "Upgraded to Next.js 15 and refreshed every vulnerable dependency; npm audit reports no known vulnerabilities.",
      "Fixed the hydration mismatch reported on load, caused by the saved theme being applied before the page hydrated.",
      "The FAQ is now a documentation page: a section rail, an \"On this page\" list, live search, and headings you can link to.",
      "Release Notes open beside the sidebar instead of on a page of their own.",
      "Feedback is a modal you can open from the account menu anywhere in the app, with an optional report type.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-08-20",
    title: "Workspaces, smarter titles, help pages",
    changes: [
      "Workspaces: group conversations under Projects, each with its own instructions applied to every chat inside it.",
      "A workspace panel beside the conversation holds those instructions and the workspace name.",
      "A model you picked yourself is no longer swapped silently when it fails — the turn stops and offers to change model. Auto still finds a working one.",
      "Conversations are named from their first exchange instead of the opening line, so greetings and typos no longer become titles.",
      "Opening a conversation keeps it in the address bar, so a refresh reopens exactly that chat and New Chat stays empty.",
      "Feedback, FAQ and Release Notes are now real pages, reachable from the account menu under Help.",
      "Rebuilt sidebar: fixed navigation, Projects and History sections, and a properly sized icon rail when collapsed.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-07-30",
    title: "More models, fewer dead ends",
    changes: [
      "The model picker lists every configured provider, with \"More models\" for the ones behind the active provider.",
      "A busy or failing model now falls back to another configured one mid-request instead of dropping the turn.",
      "Thinking and Web search became per-message toggles in the composer.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-06-18",
    title: "History you can search",
    changes: [
      "Full-text search across your conversations, grouped by date.",
      "Optional personalisation from your earlier chats, off by default in Data Controls.",
      "Export every conversation as Markdown in one archive.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-05-05",
    title: "First release",
    changes: [
      "Streaming chat with saved conversations, custom instructions and a dark interface.",
      "Temporary chats that are never written to your history.",
      "English, Filipino and Taglish handled in the same conversation.",
    ],
  },
];
