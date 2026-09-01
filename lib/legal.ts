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
export const LEGAL_UPDATED = "2026-09-01";

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
      id: "credits",
      title: "6. Ugnay Credits",
      body: [
        "AI usage inside Ugnay is charged in Ugnay Credits. Credits are a platform usage unit, not money and not a payment instrument. They have no cash value, they are not a deposit or a stored-value account, and they cannot be withdrawn, transferred between accounts, sold, or exchanged back into currency.",
        "Credits are held against your account and spent as you use paid features: chatting, priced from the tokens the provider reported, and web search, Knowledge recall, personalisation and reading a reply aloud when you use them. The price of each is set by the operator and can change.",
        "Ugnay may set a maximum number of credits in circulation across ordinary accounts. Where a reward would take the total past that limit, the reward is refused rather than paid in part. This never prevents you spending credits you already hold.",
        "The operator may correct a balance — including removing credits — where credits were issued in error, through a fault, or in breach of these terms. Corrections are recorded against the account.",
      ],
    },
    {
      id: "rewards",
      title: "7. Rewards, tasks and invites",
      body: [
        "Ugnay offers ways to earn credits without paying: a welcome bonus, a daily claim, streak bonuses and achievements, one-off tasks, rewarded ads and invites. These are promotional. Their amounts, conditions, cooldowns and daily limits are set by the operator and may be changed, paused or withdrawn at any time, and an unclaimed reward is not something you are owed.",
        "Eligibility is determined on the server against what your account has actually done. A reward is paid only once its condition is genuinely met.",
        "Rewarded ads pay only when the ad network confirms the view directly with Ugnay's servers. A view that is not confirmed pays nothing.",
        "Invite rewards are paid only after the person you invited has actually used Ugnay, not when a link is opened or an account is created. Sharing or copying an invite link earns nothing by itself.",
      ],
      points: [
        "Do not invite yourself, or create additional accounts in order to claim rewards more than once.",
        "Do not use automation, scripts or emulators to claim rewards, complete tasks, or generate ad views.",
        "Do not misrepresent a payment, a reference number, or a proof of payment.",
        "Do not attempt to work around a cooldown, a daily limit, a monthly invite cap, or the circulation limit.",
      ],
    },
    {
      id: "fraud",
      title: "8. Abuse of rewards",
      body: [
        "To keep rewards workable, Ugnay records a one-way hash derived from your sign-in identity and counts one-time rewards against it rather than against the account row. This is why deleting an account and creating a new one does not make a welcome bonus, a one-time task or an invite claimable again.",
        "Where credits appear to have been obtained through abuse, fraud, misrepresentation or a fault, the operator may reverse or remove those credits, refuse further rewards to the account, and suspend or close it. Purchased credits are treated the same way where the underlying payment is reversed or was not genuine.",
      ],
    },
    {
      id: "plans",
      title: "9. Buying credits",
      body: [
        "Credits can be bought in packages, each shown with its price and the credits it grants before you commit to it. Prices are shown in Philippine pesos.",
        "Payment is taken by GCash and verified manually. Ugnay is not a payment processor and does not take card details: you send the amount to the GCash account shown, then submit your reference number, a screenshot of your receipt and an optional note. That submission is a claim that you have paid — it is not verification, and it grants nothing by itself.",
        "An administrator reviews each payment by hand and either approves or rejects it. Credits are added only on approval, and only once per order. A rejected order grants nothing; where a reason is given, it is shown to you with the order.",
        "Purchased credits are subject to the same circulation limit as every other credit. Where an approval cannot be completed for that reason, the operator will say so rather than part-crediting the order.",
        "Because credits are a usage unit with no cash value rather than goods, purchases are not generally refundable, except where the law requires it or where a payment was taken or credited in error. Raise anything of that kind from the Feedback page.",
        "PayPal is shown in the store but is not available: no PayPal integration exists, and no payment can be made through it.",
      ],
    },
    {
      id: "availability",
      title: "10. Availability and changes",
      body: [
        "Ugnay is provided as it is, without warranties of any kind. Models go offline, providers rate-limit requests, and features change. When a model cannot answer, Ugnay will either retry, offer a different model, or ask you to choose one.",
        "Features may be added, changed or removed. Where a change would affect your saved data, we will make the effect clear in the app before it takes hold.",
      ],
    },
    {
      id: "liability",
      title: "11. Liability",
      body: [
        "To the extent the law allows, Ugnay is not liable for indirect or consequential loss, for lost profits, or for loss of data arising from your use of the service. Nothing here limits liability that cannot be limited by law.",
      ],
    },
    {
      id: "ending",
      title: "12. Ending your use",
      body: [
        "You can stop using Ugnay whenever you like. Deleting your account from Settings removes your profile, conversations, messages, workspaces, prompts, settings, share links, saved memories and feedback, and signs you out everywhere. That deletion cannot be undone.",
        "Any credit balance is removed with the account and is not refunded, transferred or reinstated. The hash described in section 8 is deliberately kept, so one-time rewards already claimed by that sign-in identity stay claimed.",
        "An administrator may also clear one account's application data without removing the sign-in itself — for example where content breaches these terms. The same hash is kept in that case, for the same reason.",
        "We may suspend or close an account that breaks these terms, abuses the reward or payment systems, or puts the service or other people at risk.",
      ],
    },
    {
      id: "terms-changes",
      title: "13. Changes to these terms",
      body: [
        "These terms will change as Ugnay does. The date at the top of this page is the last substantive edit, and continuing to use the app after a change means the updated terms apply to you.",
      ],
    },
    {
      id: "terms-contact",
      title: "14. Contact",
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
        "Credits: your balance and totals, and a record of every change to it — what it was for, how much, and the balance afterwards. Where a charge came from AI usage, that record holds the provider, the model and the token counts, never the text of a message.",
        "Rewards: which one-time rewards and tasks have been claimed, and when, so they cannot be claimed twice.",
        "Invites: your invite code, and a row for each person who joined through it recording only that they joined, whether it qualified, and what it paid. A referrer is never shown who the other person is.",
        "Purchases, if you buy credits: the package, the price, the payment method, the reference number you entered, any note you added, the screenshot you uploaded as proof, and the outcome of the review.",
      ],
    },
    {
      id: "identity-hash",
      title: "2. The identity hash behind rewards",
      body: [
        "One-time rewards — the welcome bonus, the one-off tasks, an invite — have to survive an account being deleted and made again, or they could be claimed over and over. Ugnay does this with as little data as possible: a one-way SHA-256 hash derived from your sign-in identity, and nothing else.",
        "For a Google sign-in the input is the provider's own stable identifier for you; for an email sign-in it is your normalised email address. Either way only the hash is stored — the address itself is never kept in this record, the hash cannot be turned back into it, and it is useful for nothing but answering whether that identity has already claimed a given reward.",
        "This record is kept when an account is deleted. That is deliberate, and it is the only thing about you that deletion leaves behind. It carries no name, no email address, no conversation and no account id.",
      ],
    },
    {
      id: "payments",
      title: "3. Payment information",
      body: [
        "Ugnay is not a payment processor. It does not collect or store card numbers, bank details or GCash credentials, and no card details are ever entered into the app. Payment happens in GCash, outside Ugnay.",
        "What Ugnay does store is what you type and upload when you tell it you have paid: the reference number, the amount you said you sent, an optional note, and the screenshot you attached. The screenshot is held in a private bucket, and is readable only by you and by an administrator reviewing that payment — never by other accounts and never through a public link.",
        "This information exists so a person can check a payment by hand. It is not sent to an analytics service and is not shared beyond the review.",
      ],
    },
    {
      id: "not-collected",
      title: "4. What Ugnay does not do",
      body: [
        "There is no advertising in Ugnay, no third-party analytics or tracking scripts, and no selling or sharing of your conversations with anyone other than the model provider that has to read a message in order to answer it.",
        "Your conversations are not used to train AI models.",
      ],
    },
    {
      id: "providers",
      title: "5. Where your messages go",
      body: [
        "To generate a reply, the content of the current conversation — your message, the recent turns, and the instructions that apply to it — is sent from Ugnay's server to the provider behind the model you selected: OpenRouter, Groq, Google Gemini, Cohere or Puter. Their own terms and privacy practices govern what they do with it while they process it.",
        "Provider API keys are held on the server only. Your browser never talks to a model provider directly, and no provider key is ever sent to it.",
        "Two smaller features use the same route: reading a reply aloud sends that reply's text for speech synthesis, and dictation refinement sends the transcribed text — only if you chose a refinement mode in Settings.",
      ],
    },
    {
      id: "isolation",
      title: "6. Who can see your data",
      body: [
        "Every table is protected by row-level security in the database: a signed-in account can read and write only rows that belong to it. That check runs in the database itself, so it holds even for requests that come straight from the browser.",
        "The one deliberate exception is a share link. A shared conversation is readable by anyone with the link, through a narrow function that returns only the conversation title and its user and assistant turns, up to the moment you shared it. Your instructions, workspace, model, token counts and identity are not exposed, and revoking the link ends the access.",
      ],
    },
    {
      id: "memory",
      title: "7. Memory and personalisation",
      body: [
        "\"Personalize AI with your conversation history\" is off unless you switch it on. With it on, your messages are turned into embeddings so relevant excerpts from your earlier conversations can be recalled as context for a new reply. The search runs only over your own rows.",
        "You can see exactly what has been remembered, and clear it, from the Memory dialog. Each workspace also has its own memory switch, and both must be on for recall to happen inside that workspace.",
      ],
    },
    {
      id: "temporary",
      title: "8. Temporary chat",
      body: [
        "A temporary conversation does not appear in your history, is not included in your export, and is not used for memory or personalisation.",
        "So that the record is complete, the turns are still written to one hidden conversation on your account that no listing reads, and replies from metered models still count toward that model's monthly cap. Deleting your account deletes them with everything else.",
      ],
    },
    {
      id: "improve",
      title: "9. Ratings and feedback",
      body: [
        "\"Improve the model\" is off unless you switch it on. With it off, a thumbs up or down stays in the interface and nothing is written down. With it on, the rating is stored against that reply so it can be reviewed. Despite the name, nothing here is used to train a model.",
        "Feedback you send from the Feedback page is stored with your account so it can be read back by you.",
      ],
    },
    {
      id: "browser",
      title: "10. What stays in your browser",
      body: [
        "A few conveniences never reach the server. Your theme choice is mirrored into local storage so the right colours paint before the first frame. The greeting you last saw is remembered there so it does not repeat. A first message typed before signing in is held in session storage, and disappears with the tab if you never finish signing up.",
        "Dictation uses your browser's own speech recognition, and needs microphone permission you grant per site. Nothing is recorded by Ugnay.",
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies",
      body: [
        "Ugnay sets only the cookies that keep you signed in, managed by Supabase's authentication library and refreshed as you move around the app. There are no advertising or analytics cookies to consent to.",
      ],
    },
    {
      id: "retention",
      title: "12. How long it is kept",
      body: [
        "Your data stays until you remove it. Deleting a conversation deletes its messages, its saved memories and any ratings attached to them. Deleting a workspace keeps its conversations and returns them to your history.",
        "Deleting your account from Settings removes everything at once — profile, conversations, messages, workspaces, prompts, settings, share links, memories and feedback — along with your sign-in sessions. It cannot be undone, so export first if you want a copy.",
        "Your credit wallet, its balance and its history go with the account, and the balance is not refunded or reinstated. Orders you placed are removed with it.",
        "Two things are deliberately kept. The identity hash described in section 2 stays, so one-time rewards cannot be reclaimed by starting again — it holds no name, address or conversation. And if you switched on \"Improve the model for everyone\", the conversations covered by that choice are kept in a separate table that records no name, email or account id, and cannot be traced back to you.",
      ],
    },
    {
      id: "your-controls",
      title: "13. Your controls",
      body: ["Everything in this policy has a switch or a button behind it."],
      points: [
        "Export: download every conversation as a single archive, from Settings.",
        "Memory: review and clear what has been remembered, or switch personalisation off entirely.",
        "Sharing: create and revoke share links per conversation, or turn share links off account-wide.",
        "Temporary chat: hold a conversation that stays out of your history.",
        "Deletion: remove one conversation, or your whole account.",
        "Credits: see your balance and every change to it, in Credits in the account menu.",
        "Invites: see your code and the invites paid on it, in Invite & Earn.",
        "Purchases: see each order and its status, and cancel one you have not yet had reviewed.",
      ],
    },
    {
      id: "children",
      title: "14. Children",
      body: [
        "Ugnay is not intended for children under 13. If you believe a child has created an account, use the Feedback page and it will be removed.",
      ],
    },
    {
      id: "privacy-changes",
      title: "15. Changes to this policy",
      body: [
        "This policy changes when the app does, and the date at the top of the page is the last substantive edit. A change that affects what is stored or where it is sent will be described here rather than quietly folded in.",
      ],
    },
    {
      id: "privacy-contact",
      title: "16. Contact",
      body: [
        "For anything about your data — a question, a correction, or a request to remove something — use the Feedback page inside the app.",
      ],
    },
  ],
};
