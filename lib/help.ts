/**
 * Content for the Help pages: the FAQ answers and the release history.
 *
 * Both are product copy rather than user data, so they live here beside the
 * other static content modules and are edited in place as Ugnay changes.
 */

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "What is Ugnay?",
    answer:
      "Ugnay is a minimal AI chat app. You talk to several AI models in one place, and your conversations are saved to your account so you can pick any of them back up later.",
  },
  {
    question: "Which models can I use?",
    answer:
      "Whichever ones the server has keys for. Open the model picker below the composer to see them: the model you are using sits up front, and \"More models\" opens the rest, grouped by provider. Auto routes your message to a suitable free model.",
  },
  {
    question: "What do Thinking and Web search do?",
    answer:
      "Thinking asks the model to reason for longer before it answers, and shows that reasoning above the reply. Web search lets the model look things up while answering. Both are per-message toggles in the composer, so switching one takes effect on your very next message.",
  },
  {
    question: "How are conversation titles created?",
    answer:
      "After the first exchange, Ugnay summarises what the conversation is about and names it. A chat that is only a greeting keeps the placeholder title until there is a real topic. You can always rename a conversation from its row in the sidebar.",
  },
  {
    question: "What is a workspace?",
    answer:
      "A named folder for conversations, under Projects in the sidebar. Opening one reopens its most recent conversation, and the + beside it starts a new one inside it. Each workspace has its own instructions, sent with every conversation in it. Deleting a workspace keeps its conversations — they move back to History.",
  },
  {
    question: "Can I chat without saving anything?",
    answer:
      "Yes. Turn on the temporary chat from the chat header: nothing is written to your history, and the transcript is gone as soon as you leave it.",
  },
  {
    question: "Does Ugnay remember my earlier conversations?",
    answer:
      "Only if you ask it to. Settings → Data Controls has a switch for personalising replies with your history; while it is off, each conversation is answered on its own.",
  },
  {
    question: "Can I export my data?",
    answer:
      "Yes. Settings → Data Controls exports every conversation as Markdown files in a single archive.",
  },
  {
    question: "Do I have to pay?",
    answer:
      "No. Ugnay runs on free models by default and the Free plan needs no card. The Upgrade page lists the tiers planned beyond it.",
  },
  {
    question: "Something is wrong — how do I report it?",
    answer:
      "Send it from the Feedback page. Bug reports are the most useful thing you can send: what you did, what you expected, and what happened instead.",
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
