# Ugnay v0.4.0

Workspaces, conversation titles that describe the conversation, and the Help pages behind the
account menu. Everything below is in the code; anything listed in the UI but not built yet is called
out under Known limitations.

## Highlights

- **Workspaces (Projects).** Named folders for conversations. Opening a workspace reopens its most
  recent conversation; the `+` beside it starts a new one inside it. Chats created in a workspace
  carry `project_id` and are listed under it rather than in History, and deleting a workspace keeps
  its conversations — they return to History.
- **Workspace instructions.** A panel beside the conversation holds each workspace's instructions and
  its name. Those instructions are sent with every conversation in that workspace, merged with your
  global and per-chat instructions.
- **Help pages.** Feedback, FAQ and Release Notes are real pages (`/feedback`, `/faq`,
  `/release-notes`), linked from the account menu. Feedback submissions are stored against the
  sending account.

## Improvements

- **Conversation titles are summarised, not copied.** A title is generated from the first user +
  assistant exchange, so questions, typos and greetings no longer become the title. A chat with no
  topic yet keeps the "New chat" placeholder.
- **Fallback follows your choice.** Auto (`openrouter/free`) may switch to another configured model
  when an upstream is busy or failing. A model you picked yourself is retried once without the
  optional extras and otherwise stops the turn with a **Change model** action that opens the picker —
  no silent substitution.
- **Rebuilt sidebar.** Fixed navigation, Projects and History sections, independently scrolling
  history, and a properly sized, centred icon rail when collapsed.
- **Tab title follows the conversation** (`<conversation> | Ugnay`), with `Ugnay` on a new chat.

## Fixes

- The open conversation is reflected in the route (`/?chat=<id>`), so a refresh reopens exactly that
  conversation and New Chat no longer auto-selects the first chat in history.
- Conversations created inside a workspace stay listed under that workspace after a reload.
- "More models" in the model picker is no longer clipped by the menu's own scrolling container.
- Fixed a build failure in the greeting code path (`ChatWindow` passed a partial previous-greeting
  object).

## Upgrading

Re-run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. It is idempotent and
adds this release's `projects` table, `projects.instructions`, `chats.project_id` and `app_feedback`,
along with their indexes, triggers and RLS policies. No environment variables were added or renamed.

## Known limitations

- Paid plans on `/upgrade` have no checkout; every account is on the Free plan.
- Image, Automations, Skills and Connectors, Community, Shared Links and workspace sharing appear in
  the UI as not-yet-available and have no implementation behind them.
- Personalisation with history requires the `vector` extension and the `match_user_messages`
  function from `schema.sql`; without them the app falls back to a digest of recent conversation
  titles.
- Puter is excluded from automatic model selection and capped per account per month
  (`PUTER_MONTHLY_LIMIT`, default 50), because it draws on a metered balance.
