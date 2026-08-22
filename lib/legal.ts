/**
 * Content for the legal pages: the Terms of Service and the Privacy Policy.
 *
 * Product copy rather than user data, so it lives here beside lib/help.ts and
 * is edited in place as Ugnay changes. Every statement describes what the app
 * actually does today — when a feature changes, the clause changes with it, and
 * `LEGAL_UPDATED` moves to that date.
 */

export interface DocLink {
  href: string;
  label: string;
  /** Secondary line under the label, e.g. the bare domain. */
  hint?: string;
}

export interface LegalSection {
  /** Stable anchor, used by the "On this page" rail and by deep links. */
  id: string;
  title: string;
  /** One paragraph per entry. Rendered in order. */
  body: string[];
  /** Optional bullet list, rendered after the paragraphs. */
  points?: string[];
  /** Optional link cards, rendered after the bullets. */
  links?: DocLink[];
}

export interface LegalDocument {
  /** Shown as the page heading and, by default, in the search placeholder. */
  title: string;
  /** Eyebrow above the heading. Defaults to "Legal". */
  eyebrow?: string;
  /** One line under the title, describing what the document covers. */
  summary: string;
  /** Overrides the "Search the <title>" placeholder where that reads oddly. */
  searchLabel?: string;
  /** Set for the documents that carry a last-updated date. */
  dated?: boolean;
  sections: LegalSection[];
}

/** Last substantive edit to either document, shown on both pages. */
export const LEGAL_UPDATED = "2026-08-22";

export const TERMS: LegalDocument = {
  dated: true,
  title: "Terms of Service",
  summary:
    "The agreement between you and Ugnay when you use the app. Written to be read, not skimmed past.",
  sections: [
    {
      id: "the-service",
      title: "1. What Ugnay is",
      body: [
        "Ugnay is an AI chat workspace. You write a message, Ugnay sends it to the AI model you selected, and the reply is streamed back and saved to your account. Conversations can be grouped into workspaces, each with its own instructions, and reused prompts can be kept in a prompt library.",
        "Ugnay does not build the AI models it talks to. It routes your messages to third-party providers — OpenRouter, Groq, Google Gemini, Cohere and Puter — depending on which model you pick. Which models appear in the picker depends on which providers the server has been configured with.",
      ],
    },
    {
      id: "your-account",
      title: "2. Your account",
      body: [
        "You need an account to save conversations. You can sign up with an email address and password, or continue with Google. Authentication is handled by Supabase on Ugnay's behalf.",
        "You are responsible for keeping your sign-in credentials to yourself and for everything done through your account. Tell us if you believe someone else has access to it.",
        "You may use Ugnay without an account, but only to type a first message on the landing page. Nothing is sent to a model or saved until you sign in.",
      ],
    },
    {
      id: "acceptable-use",
      title: "3. Acceptable use",
      body: [
        "Use Ugnay for your own work and curiosity. Do not use it to do harm or to break the law, and do not use it in ways that put the service or the providers behind it at risk.",
      ],
      points: [
        "No unlawful content, harassment, or material that sexualises minors.",
        "No attempts to break, overload, or work around the app's limits — including the per-account rate limits and the monthly caps on metered models.",
        "No accessing another person's account, data, or share links without their permission.",
        "No reselling access to Ugnay or its models, and no automated scraping of the app.",
        "No presenting a model's output as professional medical, legal, or financial advice.",
      ],
    },
    {
      id: "ai-output",
      title: "4. AI replies can be wrong",
      body: [
        "Model output is generated text. It can be confidently incorrect, out of date, or entirely invented — this is why every screen carries the reminder that Ugnay can make mistakes and that important information should be verified.",
        "Ugnay does not review replies before you see them and makes no promise that any answer is accurate, complete, or fit for a particular purpose. Decisions you take based on a reply are yours.",
        "Web search and extended thinking are per-message switches. With them off, the model is instructed to answer from what it already knows and not to browse; a model that ignores that instruction is a limitation of that provider, not a feature of Ugnay.",
      ],
    },
    {
      id: "your-content",
      title: "5. Your content",
      body: [
        "Your messages, workspace instructions, saved prompts and settings stay yours. You grant Ugnay only the permission it needs to run the service: to store your content, to send it to the provider you chose so a reply can be generated, and to show it back to you.",
        "You can export everything as a single archive from Settings, and you can delete individual conversations, your saved memories, or your whole account at any time.",
        "If you create a share link, the conversation becomes readable by anyone holding that link, frozen at the moment you created it. Revoking the link ends that access.",
      ],
    },
    {
      id: "plans",
      title: "6. Plans and payment",
      body: [
        "Ugnay is currently free. The plans listed on the upgrade page are not purchasable yet — no billing provider is connected, no card is collected, and every account is on the Free plan.",
        "Some models draw on a metered balance the operator pays for. Those are capped per account per month, and the app tells you when a cap has been reached and asks you to pick another model.",
      ],
    },
    {
      id: "availability",
      title: "7. Availability and changes",
      body: [
        "Ugnay is provided as it is, without warranties of any kind. Models go offline, providers rate-limit requests, and features change. When a model cannot answer, Ugnay will either retry, offer a different model, or ask you to choose one.",
        "Features may be added, changed or removed. Where a change would affect your saved data, we will make the effect clear in the app before it takes hold.",
      ],
    },
    {
      id: "liability",
      title: "8. Liability",
      body: [
        "To the extent the law allows, Ugnay is not liable for indirect or consequential loss, for lost profits, or for loss of data arising from your use of the service. Nothing here limits liability that cannot be limited by law.",
      ],
    },
    {
      id: "ending",
      title: "9. Ending your use",
      body: [
        "You can stop using Ugnay whenever you like. Deleting your account from Settings removes your profile, conversations, messages, workspaces, prompts, settings, share links, saved memories and feedback, and signs you out everywhere. That deletion cannot be undone.",
        "We may suspend an account that breaks these terms or that puts the service or other people at risk.",
      ],
    },
    {
      id: "terms-changes",
      title: "10. Changes to these terms",
      body: [
        "These terms will change as Ugnay does. The date at the top of this page is the last substantive edit, and continuing to use the app after a change means the updated terms apply to you.",
      ],
    },
    {
      id: "terms-contact",
      title: "11. Contact",
      body: [
        "Questions, disputes and corrections all go through the same place: the Feedback page inside the app. Say what you were doing and what you expected — it reaches the people who can act on it.",
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  dated: true,
  title: "Privacy Policy",
  summary:
    "What Ugnay stores, who it is sent to, what stays off by default, and how to get rid of it.",
  sections: [
    {
      id: "what-we-collect",
      title: "1. What Ugnay stores",
      body: [
        "Ugnay keeps only what it needs to be a chat app you can come back to. Everything below lives in Ugnay's own database, in rows tied to your account.",
      ],
      points: [
        "Account details: your email address, a display name, an optional nickname, and an avatar URL if your sign-in provider supplied one.",
        "Conversations: your messages, the replies, which provider and model answered, and the token counts each provider reported.",
        "Organisation: your workspaces and their instructions, saved prompts, pinned and archived states, and share links you created.",
        "Preferences: your default model, temperature and reply length, theme, and every switch in Settings.",
        "Optional extras, only when you turn them on: saved memories from your own messages, and thumbs up/down ratings.",
        "Product feedback you send from the Feedback page.",
      ],
    },
    {
      id: "not-collected",
      title: "2. What Ugnay does not do",
      body: [
        "There is no advertising in Ugnay, no third-party analytics or tracking scripts, and no selling or sharing of your conversations with anyone other than the model provider that has to read a message in order to answer it.",
        "Your conversations are not used to train AI models.",
      ],
    },
    {
      id: "providers",
      title: "3. Where your messages go",
      body: [
        "To generate a reply, the content of the current conversation — your message, the recent turns, and the instructions that apply to it — is sent from Ugnay's server to the provider behind the model you selected: OpenRouter, Groq, Google Gemini, Cohere or Puter. Their own terms and privacy practices govern what they do with it while they process it.",
        "Provider API keys are held on the server only. Your browser never talks to a model provider directly, and no provider key is ever sent to it.",
        "Two smaller features use the same route: reading a reply aloud sends that reply's text for speech synthesis, and dictation refinement sends the transcribed text — only if you chose a refinement mode in Settings.",
      ],
    },
    {
      id: "isolation",
      title: "4. Who can see your data",
      body: [
        "Every table is protected by row-level security in the database: a signed-in account can read and write only rows that belong to it. That check runs in the database itself, so it holds even for requests that come straight from the browser.",
        "The one deliberate exception is a share link. A shared conversation is readable by anyone with the link, through a narrow function that returns only the conversation title and its user and assistant turns, up to the moment you shared it. Your instructions, workspace, model, token counts and identity are not exposed, and revoking the link ends the access.",
      ],
    },
    {
      id: "memory",
      title: "5. Memory and personalisation",
      body: [
        "\"Personalize AI with your conversation history\" is off unless you switch it on. With it on, your messages are turned into embeddings so relevant excerpts from your earlier conversations can be recalled as context for a new reply. The search runs only over your own rows.",
        "You can see exactly what has been remembered, and clear it, from the Memory dialog. Each workspace also has its own memory switch, and both must be on for recall to happen inside that workspace.",
      ],
    },
    {
      id: "temporary",
      title: "6. Temporary chat",
      body: [
        "A temporary conversation does not appear in your history, is not included in your export, and is not used for memory or personalisation.",
        "So that the record is complete, the turns are still written to one hidden conversation on your account that no listing reads, and replies from metered models still count toward that model's monthly cap. Deleting your account deletes them with everything else.",
      ],
    },
    {
      id: "improve",
      title: "7. Ratings and feedback",
      body: [
        "\"Improve the model\" is off unless you switch it on. With it off, a thumbs up or down stays in the interface and nothing is written down. With it on, the rating is stored against that reply so it can be reviewed. Despite the name, nothing here is used to train a model.",
        "Feedback you send from the Feedback page is stored with your account so it can be read back by you.",
      ],
    },
    {
      id: "browser",
      title: "8. What stays in your browser",
      body: [
        "A few conveniences never reach the server. Your theme choice is mirrored into local storage so the right colours paint before the first frame. The greeting you last saw is remembered there so it does not repeat. A first message typed before signing in is held in session storage, and disappears with the tab if you never finish signing up.",
        "Dictation uses your browser's own speech recognition, and needs microphone permission you grant per site. Nothing is recorded by Ugnay.",
      ],
    },
    {
      id: "cookies",
      title: "9. Cookies",
      body: [
        "Ugnay sets only the cookies that keep you signed in, managed by Supabase's authentication library and refreshed as you move around the app. There are no advertising or analytics cookies to consent to.",
      ],
    },
    {
      id: "retention",
      title: "10. How long it is kept",
      body: [
        "Your data stays until you remove it. Deleting a conversation deletes its messages, its saved memories and any ratings attached to them. Deleting a workspace keeps its conversations and returns them to your history.",
        "Deleting your account from Settings removes everything at once — profile, conversations, messages, workspaces, prompts, settings, share links, memories and feedback — along with your sign-in sessions. It cannot be undone, so export first if you want a copy.",
      ],
    },
    {
      id: "your-controls",
      title: "11. Your controls",
      body: ["Everything in this policy has a switch or a button behind it."],
      points: [
        "Export: download every conversation as a single archive, from Settings.",
        "Memory: review and clear what has been remembered, or switch personalisation off entirely.",
        "Sharing: create and revoke share links per conversation, or turn share links off account-wide.",
        "Temporary chat: hold a conversation that stays out of your history.",
        "Deletion: remove one conversation, or your whole account.",
      ],
    },
    {
      id: "children",
      title: "12. Children",
      body: [
        "Ugnay is not intended for children under 13. If you believe a child has created an account, use the Feedback page and it will be removed.",
      ],
    },
    {
      id: "privacy-changes",
      title: "13. Changes to this policy",
      body: [
        "This policy changes when the app does, and the date at the top of the page is the last substantive edit. A change that affects what is stored or where it is sent will be described here rather than quietly folded in.",
      ],
    },
    {
      id: "privacy-contact",
      title: "14. Contact",
      body: [
        "For anything about your data — a question, a correction, or a request to remove something — use the Feedback page inside the app.",
      ],
    },
  ],
};
