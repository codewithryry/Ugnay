import type { LegalDocument } from "./legal";

/**
 * Content for the About page.
 *
 * Same shape as the documents in ./legal.ts, so it renders through the very
 * same shell the FAQ, Terms and Privacy pages use — one layout, one set of
 * rails, no second design to keep in step.
 *
 * Everything stated here describes what the app actually does today.
 */
export const ABOUT: LegalDocument = {
  eyebrow: "About",
  title: "Ugnay",
  searchLabel: "this page",
  summary:
    "An AI chat workspace: several models in one place, your conversations kept, and your files answerable.",
  sections: [
    {
      id: "what-it-is",
      title: "What Ugnay is",
      body: [
        "You write a message, pick which model answers it, and the reply streams back and stays in your account — so a conversation you started last week is still there to pick up.",
        "Rather than one assistant, it routes to several. The model picker lists whichever providers the server has keys for, and Auto finds a working free one when you would rather not choose. When a model is busy or fails mid-turn, Auto moves to another instead of losing the answer.",
      ],
    },
    {
      id: "what-you-can-do",
      title: "What you can do with it",
      body: ["The pieces that make it a workspace rather than a single chat box:"],
      points: [
        "Workspaces: group conversations under a project with its own instructions, applied to every chat inside it.",
        "Knowledge: upload documents and the relevant passages are recalled while you chat, with the files they came from named under the answer.",
        "Branch a conversation from any reply, leaving the original exactly as it was.",
        "Compare models: send one prompt to up to four models and read the replies side by side.",
        "A prompt library for the things you ask often, and a canvas for substantial generated code or documents.",
        "Temporary chat for a conversation that stays out of your history.",
        "Share a conversation as a read-only link, frozen at the moment you shared it and revocable at any time.",
      ],
    },
    {
      id: "languages",
      title: "English, Filipino, Taglish",
      body: [
        "A lot of us do not think in one language at a time. Ugnay is instructed to handle English, Filipino and Taglish in the same conversation, to read past typos and shorthand rather than asking you to rephrase, and to answer in the language you are writing in.",
      ],
    },
    {
      id: "your-data",
      title: "Your data",
      body: [
        "Every table is scoped to your account in the database itself, not just in the app, so one account cannot reach another's conversations. You can export everything in one archive, clear what Ugnay remembers, and delete your account and its contents from Settings.",
        "The Privacy Policy sets out exactly what is stored, which provider a message is sent to so it can be answered, and how long any of it is kept.",
      ],
    },
    {
      id: "built-by",
      title: "Built by",
      body: [
        "Ugnay is built and maintained by Reymel Mislang, in the open. The whole thing — the interface, the provider routing, the schema — is on GitHub if you want to read it, run it yourself, or tell me what is wrong with it.",
      ],
      links: [
        {
          href: "https://github.com/codewithryry/Ugnay",
          label: "Source on GitHub",
          hint: "codewithryry/Ugnay",
        },
        {
          href: "https://www.linkedin.com/in/reymelreymislang/",
          label: "LinkedIn",
          hint: "Reymel Mislang",
        },
        {
          href: "https://devrymel.vercel.app/",
          label: "Portfolio",
          hint: "devrymel.vercel.app",
        },
      ],
    },
  ],
};
