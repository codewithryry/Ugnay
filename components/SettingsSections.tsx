"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Trash2, type LucideIcon } from "lucide-react";
import { applyTheme, THEME_STORAGE_KEY, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import MemoryModal from "./MemoryModal";
import { useChatStore } from "@/store/chatStore";
import type { Preset } from "@/types/db";

/**
 * The settings controls shared by both settings shells.
 *
 * The desktop dialog and the compact PWA panel frame these differently but
 * render exactly the same rows, so the rows live here once. Only the shells and
 * their Account views are per-form-factor.
 */

// One shared right-hand control column, so switches, dropdowns and buttons all
// end on the same edge no matter how long the label or description is.
export const settingRowClass =
  "flex items-start justify-between gap-3 border-b border-ink-800 py-3 last:border-b-0 sm:gap-4";
export const controlSlotClass = "flex w-28 shrink-0 items-center justify-end pt-0.5 sm:w-32";

export const pillClass =
  "shrink-0 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800";

export const rowActionClass =
  "flex h-9 w-28 shrink-0 items-center justify-center rounded-full border border-ink-700 text-xs text-neutral-300 transition hover:bg-ink-800 disabled:opacity-60 sm:h-8 sm:w-32";

export const actionClass =
  "shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-800 disabled:opacity-60";

export const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm";

export function Row({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-800 py-3 last:border-b-0">
      <p className="flex w-full shrink-0 items-center gap-2 text-sm text-neutral-100 sm:w-32">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />}
        {label}
      </p>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {children}
      </div>
    </div>
  );
}

/**
 * Theme picker plus the code-wrap switch.
 *
 * `compact` is the PWA sheet's variant: the three theme cards sit in a single
 * row at phone width instead of stacking, under a small "Theme" label. The
 * desktop dialog leaves it off and renders exactly as before.
 */
export function AppearanceSection({ compact = false }: { compact?: boolean }) {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const theme = settings?.theme ?? "dark";

  // Apply immediately, then persist for this account.
  async function choose(next: ThemeChoice) {
    applyTheme(next);
    await saveSettings({ theme: next });
  }

  return (
    <Section>
      <div>
        {compact && <p className="mb-2 text-xs text-neutral-400">Theme</p>}
        <div className={compact ? "grid grid-cols-3 gap-2" : "grid gap-3 sm:grid-cols-3"}>
          {THEMES.map((option) => {
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void choose(option.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border text-left transition hover:border-ink-600",
                  compact ? "p-1.5" : "p-2",
                  active
                    ? compact
                      ? "border-neutral-300"
                      : "border-accent ring-1 ring-accent/50"
                    : "border-ink-700",
                )}
              >
                <ThemePreview id={option.id} />
                <span
                  className={cn(
                    "block",
                    compact ? "mt-1.5 text-center text-[11px]" : "mt-2 px-1 text-xs",
                    active ? "text-neutral-100" : "text-neutral-400",
                  )}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Toggle
        label="Wrap long lines for code blocks by default"
        hint={compact ? undefined : "Wrap code instead of scrolling it horizontally."}
        checked={settings?.wrap_code_lines ?? false}
        onChange={(v) => void saveSettings({ wrap_code_lines: v })}
      />
    </Section>
  );
}

export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Inline SVG mock of a sidebar + message list, tinted for each theme. */
export function ThemePreview({ id }: { id: ThemeChoice }) {
  const dark = { bg: "#111113", panel: "#1c1c1f", line: "#3f3f46", accent: "#d4d4d8" };
  const light = { bg: "#ffffff", panel: "#e9e9ee", line: "#c2c2cb", accent: "#3f3f46" };

  return (
    <svg viewBox="0 0 96 60" role="img" aria-hidden className="h-auto w-full rounded-lg">
      {id === "system" ? (
        <>
          <clipPath id="theme-split-left">
            <rect x="0" y="0" width="48" height="60" />
          </clipPath>
          <clipPath id="theme-split-right">
            <rect x="48" y="0" width="48" height="60" />
          </clipPath>
          <g clipPath="url(#theme-split-left)">
            <PreviewBody palette={light} />
          </g>
          <g clipPath="url(#theme-split-right)">
            <PreviewBody palette={dark} />
          </g>
        </>
      ) : (
        <PreviewBody palette={id === "light" ? light : dark} />
      )}
    </svg>
  );
}

export function PreviewBody({
  palette,
}: {
  palette: { bg: string; panel: string; line: string; accent: string };
}) {
  return (
    <>
      <rect x="0" y="0" width="96" height="60" fill={palette.bg} />
      <rect x="0" y="0" width="26" height="60" fill={palette.panel} />
      <rect x="5" y="6" width="16" height="3" rx="1.5" fill={palette.accent} />
      <rect x="5" y="14" width="14" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="5" y="20" width="16" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="5" y="26" width="12" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="33" y="10" width="40" height="3" rx="1.5" fill={palette.accent} />
      <rect x="33" y="18" width="54" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="33" y="24" width="48" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="33" y="30" width="52" height="2.5" rx="1.25" fill={palette.line} />
      <rect x="33" y="44" width="54" height="9" rx="4.5" fill={palette.panel} stroke={palette.line} />
    </>
  );
}

export function BehaviorSection() {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);

  const [notifyBlocked, setNotifyBlocked] = useState(false);

  // Notifications need the browser's permission before they can be delivered,
  // so the setting only turns on once permission is actually granted.
  async function setNotify(value: boolean) {
    setNotifyBlocked(false);
    if (value && typeof Notification !== "undefined") {
      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
      if (permission !== "granted") {
        setNotifyBlocked(true);
        await saveSettings({ notify_on_finish: false });
        return;
      }
    }
    await saveSettings({ notify_on_finish: value });
  }

  return (
    <div className="space-y-1">
      <Toggle
        label="Enable auto scroll"
        hint="Follow the newest message while a reply streams in."
        checked={settings?.auto_scroll ?? true}
        onChange={(v) => void saveSettings({ auto_scroll: v })}
      />
      <Toggle
        label="Notify when AI finishes thinking"
        hint="Shows a browser notification when a reply completes and Ugnay is in the background."
        checked={settings?.notify_on_finish ?? false}
        onChange={(v) => void setNotify(v)}
      />
      {notifyBlocked && (
        <p role="alert" className="pb-2 text-xs text-danger">
          Your browser blocked notifications for this site. Allow them in the site settings, then
          try again.
        </p>
      )}
      <Toggle
        label="Require Cmd+Enter to submit"
        hint="Cmd+Enter (macOS) or Ctrl+Enter (Windows/Linux) sends the message; Enter inserts a new line."
        checked={settings?.cmd_enter_to_submit ?? false}
        onChange={(v) => void saveSettings({ cmd_enter_to_submit: v })}
      />
      <Toggle
        label="Enable Rich Text Editor"
        hint="Enable code blocks and lists in the query bar."
        checked={settings?.rich_text_editor ?? false}
        onChange={(v) => void saveSettings({ rich_text_editor: v })}
      />
      <SelectSetting
        label="Dictation Refinement"
        hint="How much Ugnay refines your speech-to-text transcriptions."
        value={settings?.dictation_refinement ?? "none"}
        options={DICTATION_OPTIONS}
        onChange={(v) => void saveSettings({ dictation_refinement: v })}
      />
    </div>
  );
}

export const DICTATION_OPTIONS: {
  value: "none" | "tidy" | "full";
  label: string;
  description: string;
}[] = [
  {
    value: "none",
    label: "No refinement",
    description: "Keeps your exact spoken words without any changes.",
  },
  {
    value: "tidy",
    label: "Tidy up",
    description: "Cleans up grammar, filler words, and punctuation.",
  },
  {
    value: "full",
    label: "Fully refine",
    description: "Rewrites the text completely for maximum clarity and conciseness.",
  },
];

/** Saved presets, shown under Customize alongside the custom instructions. */
export function PresetsSection({
  presets,
  newPreset,
  setNewPreset,
  onAdd,
  onRemove,
}: {
  presets: Preset[];
  newPreset: { name: string; prompt: string };
  setNewPreset: React.Dispatch<React.SetStateAction<{ name: string; prompt: string }>>;
  onAdd: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  return (
    <Section>
      <ul className="space-y-2">
        {presets.map((preset) => (
          <li
            key={preset.id}
            className="flex items-start gap-3 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-neutral-200">
                {preset.name}
                {preset.builtin && (
                  <span className="ml-2 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                    Built-in
                  </span>
                )}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{preset.prompt}</p>
            </div>
            {!preset.builtin && (
              <button
                type="button"
                onClick={() => void onRemove(preset.id)}
                aria-label={`Delete preset ${preset.name}`}
                className="rounded p-1 text-neutral-500 hover:bg-ink-800 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="space-y-2 rounded-xl border border-dashed border-ink-700 p-3">
        <label htmlFor="preset-name" className="sr-only">
          Preset name
        </label>
        <input
          id="preset-name"
          value={newPreset.name}
          onChange={(e) => setNewPreset((p) => ({ ...p, name: e.target.value }))}
          placeholder="Preset name"
          className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600"
        />
        <label htmlFor="preset-prompt" className="sr-only">
          Preset instructions
        </label>
        <textarea
          id="preset-prompt"
          rows={3}
          value={newPreset.prompt}
          onChange={(e) => setNewPreset((p) => ({ ...p, prompt: e.target.value }))}
          placeholder="Instructions this preset applies…"
          className="w-full resize-y rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600"
        />
        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={!newPreset.name.trim() || !newPreset.prompt.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-ink-800 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add preset
        </button>
      </div>
    </Section>
  );
}

export function DataSection() {
  const chats = useChatStore((s) => s.chats);
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const deleteChat = useChatStore((s) => s.deleteChat);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<null | "export" | "delete" | "cache">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  async function toggle(key: keyof typeof FLAGS, value: boolean) {
    setError(null);
    await saveSettings({ [key]: value });
  }

  // Streams /api/export (server-side, RLS-scoped) into a .zip download.
  async function exportChats() {
    setBusy("export");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/export");
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Export failed (${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ugnay-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("Export downloaded.");
    } catch (err) {
      console.error("[ugnay] Export failed:", err);
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAllConversations() {
    setBusy("delete");
    setConfirmAll(false);
    setError(null);
    setNotice(null);
    for (const chat of [...chats]) await deleteChat(chat.id);
    setBusy(null);

    // deleteChat restores its rows and sets store.error when a delete fails.
    const remaining = useChatStore.getState().chats.length;
    if (remaining > 0) {
      setError(`Could not delete ${remaining} conversation(s). Please try again.`);
      return;
    }
    setNotice("All conversations deleted.");
  }

  function clearCache() {
    setBusy("cache");
    try {
      // The theme mirror is what prevents a flash on reload, so it survives.
      const theme = localStorage.getItem(THEME_STORAGE_KEY);
      localStorage.clear();
      sessionStorage.clear();
      if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be blocked; the reload below still clears in-memory state.
    }
    window.location.reload();
  }

  return (
    <div className="space-y-6">
      <Section>
        <Toggle
          label="Improve the model"
          hint="Allow your conversations to be reviewed to improve Ugnay. Off by default; Ugnay does not train on your chats today."
          checked={settings?.improve_model ?? false}
          onChange={(v) => void toggle("improve_model", v)}
        />
        <Toggle
          label="Personalize AI with your conversation history"
          badge="beta"
          hint="Lets replies draw on your earlier conversations. Only your own chats are ever used."
          checked={settings?.personalize_with_history ?? false}
          onChange={(v) => void toggle("personalize_with_history", v)}
        />
        <Toggle
          label="Allow chat link sharing"
          hint="Shows the “copy chat link” action on responses. Links only open for you — Ugnay has no public sharing."
          checked={settings?.share_links_enabled ?? true}
          onChange={(v) => void toggle("share_links_enabled", v)}
        />
      </Section>

      <section className="border-t border-ink-800 pt-2">
        <ActionRow
          title="Memory"
          description="Review what Ugnay remembers from earlier conversations, forget individual items, or clear everything."
          action="Manage"
          disabled={busy !== null}
          onClick={() => setMemoryOpen(true)}
        />

        <ActionRow
          title="Clear Cache"
          description="Clear the local cache and application state on your device."
          action="Clear"
          busy={busy === "cache"}
          disabled={busy !== null}
          onClick={clearCache}
        />

        <ActionRow
          title="Export Account Data"
          description="You can download all data associated with your account below. This data includes everything stored in Ugnay."
          action="Export"
          busy={busy === "export"}
          disabled={busy !== null}
          onClick={() => void exportChats()}
        />

        <ActionRow
          title="Delete All Conversations"
          description="Delete all of your conversation data."
          action={confirmAll ? "Confirm" : "Delete"}
          destructive
          busy={busy === "delete"}
          disabled={busy !== null || chats.length === 0}
          onClick={() => (confirmAll ? void deleteAllConversations() : setConfirmAll(true))}
        />

        {confirmAll && (
          <p role="alert" className="pb-3 text-xs text-danger">
            Delete all {chats.length} conversations? This cannot be undone.{" "}
            <button
              type="button"
              onClick={() => setConfirmAll(false)}
              className="underline underline-offset-2 hover:text-danger"
            >
              Cancel
            </button>
          </p>
        )}

        {notice && (
          <p role="status" className="pb-3 text-xs text-success">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="pb-3 text-xs text-danger">
            {error}
          </p>
        )}
      </section>

      <MemoryModal open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}

/**
 * One data-control row: title and description on the left, a single
 * fixed-size action button pinned to the right so every row lines up.
 */
export function ActionRow({
  title,
  description,
  action,
  onClick,
  busy = false,
  disabled = false,
  destructive = false,
}: {
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <div className={settingRowClass}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-100">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{description}</p>
      </div>
      <span className={controlSlotClass}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-center gap-1.5 rounded-full border text-xs transition disabled:opacity-50 sm:h-8",
            destructive
              ? "border-danger/30 text-danger hover:bg-danger/10"
              : "border-ink-700 text-neutral-200 hover:bg-ink-800",
          )}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {action}
        </button>
      </span>
    </div>
  );
}

/** Keys the data toggles may write, so `toggle` stays type-safe. */
export const FLAGS = {
  improve_model: true,
  personalize_with_history: true,
  share_links_enabled: true,
};

/**
 * Dropdown setting. The trigger is a rounded pill and each choice carries its
 * own explanation inside the popup, which opens upward and is positioned
 * `fixed` so it is never clipped by the scrolling settings pane.
 */
export function SelectSetting<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: T;
  options: { value: T; label: string; description: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = options.find((o) => o.value === value) ?? options[0];

  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Opens upward from the trigger.
      // Clamped both ways: the popup hangs off the trigger's right edge, which
      // on a narrow screen would otherwise push its left edge off screen.
      const width = Math.min(256, window.innerWidth - 24);
      const maxRight = Math.max(12, window.innerWidth - width - 12);
      setAnchor({
        bottom: window.innerHeight - rect.top + 6,
        right: Math.min(Math.max(12, window.innerWidth - rect.right), maxRight),
      });
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    const close = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    // Scrolling anywhere (including the settings pane) invalidates the anchor.
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <div className={settingRowClass}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-100">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{hint}</p>
      </div>

      <div className={cn(controlSlotClass, "relative")}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            place();
            setOpen((v) => !v);
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800"
        >
          <span className="truncate">{active?.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
        </button>

        {open && anchor && (
          <>
            <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpen(false)} />
            <div
              role="listbox"
              aria-label={label}
              style={{ bottom: anchor.bottom, right: anchor.right }}
              className="fixed z-[70] max-h-[60dvh] w-[min(16rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl animate-fade-in"
            >
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition",
                      selected ? "bg-ink-800" : "hover:bg-ink-800/70",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-neutral-100">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">
                        {option.description}
                      </span>
                    </span>
                    {selected && (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-300" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  hint,
  badge,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  badge?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={settingRowClass}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-neutral-100">
          {label}
          {badge && (
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
              {badge}
            </span>
          )}
        </p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{hint}</p>}
      </div>
      <span className={controlSlotClass}>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          onClick={() => onChange(!checked)}
          className={cn(
            "flex h-5 w-9 shrink-0 items-center rounded-full border transition",
            checked ? "border-neutral-400 bg-neutral-200" : "border-ink-600 bg-ink-800",
          )}
        >
          <span
            className={cn(
              "h-3.5 w-3.5 rounded-full transition-transform",
              checked ? "translate-x-[1.15rem] bg-ink-950" : "translate-x-[0.15rem] bg-neutral-500",
            )}
          />
        </button>
      </span>
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="border-t border-ink-800 pt-6 first:border-0 first:pt-0">
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}