export type Role = "system" | "user" | "assistant";

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  /** Preferred short name; falls back to display_name when unset. */
  nickname: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  provider: string;
  model: string;
  system_prompt: string | null; // per-chat override
  /** Workspace this chat belongs to; null for a plain conversation. */
  project_id: string | null;
  /** Set when this conversation was branched out of another one. */
  branched_from_chat_id: string | null;
  branched_from_message_id: string | null;
  /** Sidebar organisation: pinned rows sort first, archived ones are hidden. */
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

/** A workspace: a named folder for conversations. */
export interface Project {
  id: string;
  user_id: string;
  name: string;
  /** Applied to every conversation in this workspace. */
  instructions: string;
  /** Model this workspace prefers; null means the account default. */
  default_provider: string | null;
  default_model: string | null;
  /** Whether conversation memory applies inside this workspace. */
  memory_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** A reusable prompt from the library. */
export interface Prompt {
  id: string;
  user_id: string;
  title: string;
  body: string;
  /** Plain label used to group the library; "" means ungrouped. */
  folder: string;
  created_at: string;
  updated_at: string;
}

/** A read-only public link to one conversation. */
export interface SharedChat {
  id: string;
  slug: string;
  chat_id: string;
  user_id: string;
  /** Messages after this instant are not exposed by the link. */
  shared_up_to: string;
  revoked: boolean;
  created_at: string;
}

/** One remembered excerpt behind Settings → Data Controls → personalisation. */
export interface MemoryEntry {
  message_id: string;
  chat_id: string;
  chat_title: string;
  content: string;
  created_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  user_id: string;
  role: Role;
  content: string;
  provider: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export interface Preset {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

export interface UserSettings {
  user_id: string;
  global_system_prompt: string;
  default_provider: string;
  default_model: string;
  temperature: number;
  max_tokens: number;
  presets: Preset[];
  /** Allow this account's chats to be used for product improvement. */
  improve_model: boolean;
  /** Show the "copy chat link" action on responses. */
  share_links_enabled: boolean;
  /** Let earlier conversations be used as context for new replies (beta). */
  personalize_with_history: boolean;
  /** Follow the newest message while a reply streams in. */
  auto_scroll: boolean;
  /** Raise a browser notification when a reply finishes. */
  notify_on_finish: boolean;
  /** Submit with Cmd/Ctrl+Enter; plain Enter inserts a newline. */
  cmd_enter_to_submit: boolean;
  /** Colour scheme: "system" follows the OS. */
  theme: "light" | "dark" | "system";
  /** Wrap long lines in code blocks instead of scrolling horizontally. */
  wrap_code_lines: boolean;
  /** Rich text (code blocks, lists) in the query bar. */
  rich_text_editor: boolean;
  /** How much speech-to-text transcriptions get rewritten. */
  dictation_refinement: "none" | "tidy" | "full";
  created_at: string;
  updated_at: string;
}
