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
    id: "credits",
    title: "Ugnay Credits",
    items: [
      {
        id: "what-are-credits",
        question: "What are Ugnay Credits?",
        answer:
          "The unit Ugnay charges AI usage in. They are not money and have no cash value: they cannot be withdrawn, transferred between accounts or exchanged back into currency. Your balance, what you have earned and spent, and your recent activity are all in Credits in the account menu.",
      },
      {
        id: "spending-credits",
        question: "What costs credits?",
        answer:
          "Chatting, priced from the number of tokens the provider actually reported rather than an estimate. Web search, Knowledge recall, personalisation from your history and reading a reply aloud are charged on top when you use them. An admin sets every price, and turning a rule off stops it charging immediately.",
      },
      {
        id: "earning-credits",
        question: "How do I earn credits without paying?",
        answer:
          "Several ways: a welcome bonus when you first sign up, credits you can claim once a day, a bonus for keeping a daily streak going, achievements at longer streaks, one-off tasks like completing your profile or uploading a Knowledge file, watching a rewarded ad, and inviting other people. Ugnay checks each task against what your account has actually done, so nothing can be claimed early or twice.",
      },
      {
        id: "out-of-credits",
        question: "What happens when I run out of credits?",
        answer:
          "Ugnay checks your balance before it calls a model, so a message you could not pay for stops before it is sent rather than failing halfway. Your conversations, files and settings are untouched — you simply cannot send a new message until you claim your daily credits, finish a task, or buy more.",
      },
      {
        id: "rewarded-ads",
        question: "How do rewarded ads work?",
        answer:
          "You watch an ad and credits are added once the ad network confirms the view directly with Ugnay's servers. Closing an ad early pays nothing, and the confirmation cannot be faked from your browser. There is a limit on how many you can be paid for in a day.",
      },
      {
        id: "referrals",
        question: "How do invite rewards work?",
        answer:
          "Open Invite & Earn in the account menu for your code and a link to share. You are paid once the person you invited has actually held a conversation — not when they open the link and not when they sign up. Copying or sharing never earns anything by itself, you cannot invite yourself, and there is a monthly cap on how many invites one account is paid for.",
      },
      {
        id: "credit-limits",
        question: "Is there a limit on credits?",
        answer:
          "Ugnay can set a maximum number of credits in circulation across all ordinary accounts. If a reward would take the total past it, the reward is refused rather than paid in part, and you are told. Spending is never affected — you can always use credits you already hold.",
      },
      {
        id: "admin-accounts",
        question: "Why is my balance shown as unlimited?",
        answer:
          "You are on an admin account. Admin accounts are not charged for AI usage, and their balances are left out of the circulation totals so those figures reflect ordinary accounts.",
      },
    ],
  },
  {
    id: "plans-and-billing",
    title: "Buying credits",
    items: [
      {
        id: "pricing",
        question: "Do I have to pay?",
        answer:
          "No. Ugnay runs on free models and every account can earn credits without spending anything — the daily claim, tasks, streaks, rewarded ads and invites all cost nothing. Buying credits is there if you would rather not wait.",
      },
      {
        id: "buy-credits",
        question: "How do I buy credits?",
        answer:
          "Open Buy credits, pick a package — each shows its price in pesos and the credits you receive — and choose GCash. Send the exact amount to the GCash number shown, then submit your reference number and a screenshot of your receipt. You can add a note if something needs explaining.",
      },
      {
        id: "payment-verification",
        question: "When do purchased credits arrive?",
        answer:
          "After an admin has checked your payment by hand. Your order shows as Pending until then, and becomes Approved once the credits are added or Rejected if the payment could not be confirmed — with the admin's reason, when one is given. A reference number, an amount or a screenshot is never treated as proof on its own, and nothing is added automatically.",
      },
      {
        id: "gcash-qr",
        question: "Is there a GCash QR code?",
        answer:
          "Not yet. Rather than show a code that cannot be scanned, the store says so and asks you to send to the GCash number shown instead. Everything else about the purchase works the same way.",
      },
      {
        id: "paypal",
        question: "Why is PayPal greyed out?",
        answer:
          "Because there is no PayPal integration yet. It is shown disabled rather than hidden so it is clear the option exists and is simply not available. GCash is the only way to buy credits today.",
      },
      {
        id: "refunds",
        question: "Can I get a refund?",
        answer:
          "Credits are a usage unit rather than a purchase of goods, and they have no cash value, so purchases are not generally refundable. If a payment was taken in error or credited wrongly, say so from the Feedback page and it will be looked at.",
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
    version: "0.11.0",
    date: "2026-09-01",
    title: "Credits you can buy and earn, invites, and supply controls",
    changes: [
      "Run this release's supabase/schema.sql in the Supabase SQL editor. It is idempotent and adds the payment method, referral and admin audit tables, the circulation ceiling, and the wallet management and cleanup functions.",
      "Invite & Earn, in the account menu: your own invite code, a link to share, how many people have joined through it and what that has paid. You earn the reward only once someone you invited has actually held a conversation — sharing or copying a link never pays anything on its own.",
      "Invites are counted against a hashed sign-in identity rather than an account, so you cannot invite yourself from a second account, and deleting and recreating an account cannot earn the same referral twice. An admin sets what a referral pays, what the person joining gets, and how many referrals one account may be paid for each month.",
      "Buying credits with GCash works end to end. Pick a package, send the exact amount to the GCash number shown, then submit your reference number, a screenshot of the receipt and an optional note. Your order shows as Pending until an admin checks it, then Approved or Rejected — with the reason, if one was given.",
      "Nothing about a payment is verified automatically. A reference number, an amount and a screenshot are claims shown to an admin, never proof: credits are added only when an admin approves the order, and only once, however many times the page is submitted or the button is pressed.",
      "A QR code for GCash is not available yet, so the store says so plainly and asks you to send to the number instead, rather than showing a code that cannot be scanned. PayPal stays greyed out and marked unavailable until a real integration exists.",
      "Admin → Payments is where GCash is configured — the number, the account name, the instructions and, later, a QR image — and where every payment is reviewed. Approving pays through the same credit ledger as every other credit.",
      "Admin → Wallets: credits in circulation across ordinary accounts, a searchable list of every wallet, one account's full history, and the ability to grant or remove credits with a reason that is recorded on the ledger.",
      "A maximum circulation can now be set. Every path that creates credits is measured against it inside the same transaction that writes the balance, so a reward that would take the supply past the ceiling is refused whole rather than paid in part. Spending is never blocked by it.",
      "An admin can delete one account's application data without touching the sign-in itself. The hashed identity that prevents reward farming is deliberately kept, so a wiped account cannot reclaim its welcome bonus or its one-time tasks, and the action is written to an admin audit log.",
      "Admin accounts are entitled rather than funded: their chat is not charged, and their balances are left out of the circulation figures so the totals mean what they say.",
      "Chat now checks your balance before calling a provider, so a turn that could not be paid for stops with a clear message instead of failing part-way through.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-08-23",
    title: "Model routing, admin dashboard and maintenance mode",
    changes: [
      "Run this release's supabase/schema.sql in the Supabase SQL editor. It is idempotent and adds the admin role, the model control and AI settings tables, the training dataset table, and the admin overview function.",
      "Auto now ranks every configured model — not just OpenRouter — and moves to the next one when a model is busy, times out or errors, so a failing provider no longer ends the turn. A model you picked yourself is still never swapped.",
      "Current models: Gemini 3.6 Flash, and GPT-OSS 120B and 20B on Groq. The retired Gemini 2.0 Flash and Llama 3.3 entries were removed.",
      "The model picker is more compact, grouped by provider, and now lists only models that are actually available.",
      "An admin dashboard at /admin: model and provider availability, maintenance and routing priority, live health and recent failures, usage totals, knowledge and training figures, and an audit of model changes. Admin-only, enforced on the server and by row level security.",
      "Maintenance switches: one takes Ugnay AI chat offline with a message of your choosing, the other takes the whole site offline for everyone but an admin, with an optional time it is expected back. Open tabs move in and out of maintenance on their own, without anyone refreshing.",
      "Deleting an account now preserves the conversations of accounts that opted into improving the model, in a separate table that holds no name, email or account id. Everything else about deletion is unchanged.",
      "Changing a model in the admin no longer reloads or interrupts a conversation: the picker updates quietly when the tab is focused again.",
      "A custom 404 page, in the same visual language as the rest of Ugnay.",
      "Ugnay Credits: AI chat is now paid for in credits, priced from the tokens a provider actually reported, with web search, knowledge recall and personalisation charged on top. The wallet lives in the account menu under Credits and shows your balance, what you earned and spent, and your recent activity.",
      "Earn credits by claiming them once a day, keeping a streak, or watching a rewarded ad. Ad credits are added only after the ad network confirms the view with Ugnay's servers.",
      "Admin → Credits sets what every feature costs, what each reward pays, the cooldowns and daily limits, and can grant credits to an account.",
      "Credits can also be bought at /credits with PayPal or GCash. Payments are confirmed by hand: you submit your reference number, the order shows as pending verification, and the credits arrive once an admin approves it.",
      "New accounts start with a welcome bonus of Ugnay Credits, claimable once. One-time rewards are remembered against a hashed sign-in identity rather than the account, so they survive deleting and recreating an account — and cannot be claimed twice that way.",
      "Tasks & Rewards: earn credits for completing your profile, creating a workspace, uploading a Knowledge file, saving a prompt, building a workflow, sharing a conversation and more. Ugnay checks each one against what your account has actually done, so nothing can be claimed twice or claimed early.",
      "Streak achievements pay a bonus at 7 and 30 consecutive days, and reading a reply aloud is priced like the other paid features. Turning a rule off in Admin stops it charging or paying immediately.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-08-22",
    title: "Knowledge, legal pages, and a lighter light theme",
    changes: [
      // Added
      "Run this release's supabase/schema.sql in the Supabase SQL editor before using Knowledge. It is idempotent and adds the passage table, the indexing columns and the file search function.",
      "Knowledge: upload the documents Ugnay should answer from. Their text is split into passages, indexed, and the relevant ones are recalled automatically while you chat. Word, plain text, Markdown, CSV, TSV and JSON are indexed; a PDF is stored but its text cannot be read yet, so it is not searched.",
      "Answers grounded in your files now name them: a Sources row under the reply lists the documents the passages came from.",
      "A file that failed to index, or only indexed in part, has a re-index button beside it.",
      "Terms of Service and Privacy Policy are real pages now, linked from the messaging notice, the sign-in screen and the account menu under Help.",
      "The FAQ, Release Notes, Terms and Privacy pages open without signing in.",
      "You can change your account email address in Settings, and delete your account and everything in it from Settings → Danger Zone.",
      "A reply's ⋯ menu names the model that produced it.",
      // Improved
      "Embeddings moved to Cohere, with an automatic switch to a second model when the first is rate limited — passages no longer go missing when a provider is busy.",
      "Knowledge states plainly when a long document was only partly indexed, instead of reporting it as complete, and re-indexing reuses the passages it already has.",
      "Compare models was rebuilt to match the rest of the app: the same composer, the same chips, the same spacing.",
      "Conversation actions in the sidebar no longer sit on top of long titles, and the account menu keeps clear of the profile row.",
      // Fixed
      "The light theme is consistent throughout: code blocks, error and success notices, buttons and scrollbars all follow it. A primary button no longer turned unreadable on hover.",
      "Knowledge indexing no longer drops passages when the embedding provider rate limits a batch.",
      // Changed
      "Blur effects were removed across the interface.",
      "The sidebar shows the Ugnay mark on its own, without the wordmark.",
    ],
  },
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
