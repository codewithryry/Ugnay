"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Database,
  Loader2,
  Mail,
  Palette,
  SlidersHorizontal,
  MessageSquareText,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import UserAvatar from "./UserAvatar";
import AccountDangerZone from "./AccountDangerZone";
import type { CurrentUser } from "./ChatApp";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  AppearanceSection,
  BehaviorSection,
  DataSection,
  PresetsSection,
  Row,
  Section,
  actionClass,
  inputClass,
  rowActionClass,
} from "./SettingsSections";
import { allPresets, useChatStore, DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/store/chatStore";
import type { Preset } from "@/types/db";

type SectionId = "account" | "appearance" | "behavior" | "customize" | "data";

interface NavItem {
  id: SectionId;
  label: string;
  icon: LucideIcon;
}

/**
 * The settings overview is a compact, grouped list of sections, each row a
 * target with a chevron. Opening a row swaps the same full-height panel to that
 * section's detail view, which keeps a compact horizontal section navigator.
 */
const GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "General",
    items: [
      { id: "account", label: "Account", icon: User },
      { id: "appearance", label: "Appearance", icon: Palette },
    ],
  },
  {
    group: "Work",
    items: [
      { id: "behavior", label: "Behavior", icon: MessageSquareText },
      { id: "customize", label: "Customize", icon: SlidersHorizontal },
    ],
  },
  {
    group: "Data & Information",
    items: [{ id: "data", label: "Data", icon: Database }],
  },
];

const SECTION_TITLES: Record<SectionId, string> = {
  account: "Account",
  appearance: "Appearance",
  behavior: "Behavior",
  customize: "Customize Ugnay",
  data: "Data Controls",
};

/**
 * The compact settings surface: a bottom sheet that opens over the app. It
 * shows a grouped overview of every section and, from any section, a detail
 * view titled by that section with a back action to the overview.
 */
export default function SettingsPanelCompact({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser;
}) {
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const catalog = useChatStore((s) => s.catalog);
  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const setChatSystemPrompt = useChatStore((s) => s.setChatSystemPrompt);
  const storeError = useChatStore((s) => s.error);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  const [section, setSection] = useState<SectionId | null>(null);
  const [globalPrompt, setGlobalPrompt] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [defaults, setDefaults] = useState({
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    temperature: 0.7,
    maxTokens: 2048,
  });
  const [saving, setSaving] = useState(false);
  const [newPreset, setNewPreset] = useState({ name: "", prompt: "" });

  // Re-seed the form when the dialog opens or the active chat changes. It must
  // NOT re-run on every `settings` write: saving an unrelated toggle would
  // otherwise discard whatever the user is typing in Customize.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;

    const current = useChatStore.getState().settings;
    setGlobalPrompt(current?.global_system_prompt ?? "");
    setChatPrompt(activeChat?.system_prompt ?? "");
    setNewPreset({ name: "", prompt: "" });
    if (current) {
      setDefaults({
        provider: current.default_provider,
        model: current.default_model,
        temperature: current.temperature,
        maxTokens: current.max_tokens,
      });
    }
  }, [open, activeChat?.id]);

  // A different conversation means a different per-chat instruction.
  useEffect(() => {
    if (open) setChatPrompt(activeChat?.system_prompt ?? "");
  }, [open, activeChat?.id, activeChat?.system_prompt]);

  // Every open starts at the grouped overview.
  useEffect(() => {
    if (open) setSection(null);
  }, [open]);

  // The panel owns its dialog behaviour: focus trap, Escape to close, and a
  // locked body scroll while it is on screen.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const restoreFocusTo = document.activeElement as HTMLElement | null;

    function focusables() {
      return Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    }

    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      restoreFocusTo?.focus?.();
    };
  }, [open, onClose]);

  const available = catalog.filter((p) => p.configured);
  const presets = allPresets(settings);
  const customPresets = presets.filter((p) => !p.builtin);

  async function persist() {
    setSaving(true);
    await saveSettings({
      global_system_prompt: globalPrompt,
      default_provider: defaults.provider,
      default_model: defaults.model,
      temperature: defaults.temperature,
      max_tokens: defaults.maxTokens,
    });
    if (activeChat) await setChatSystemPrompt(activeChat.id, chatPrompt);
    setSaving(false);
    onClose();
  }

  // Presets are stored on the settings row, so they save immediately rather
  // than waiting on the dialog's Save button.
  async function addPreset() {
    const name = newPreset.name.trim();
    const prompt = newPreset.prompt.trim();
    if (!name || !prompt) return;
    const preset: Preset = { id: `custom-${name.toLowerCase().replace(/\s+/g, "-")}`, name, prompt };
    await saveSettings({ presets: [...customPresets, preset] });
    setNewPreset({ name: "", prompt: "" });
  }

  async function removePreset(id: string) {
    await saveSettings({ presets: customPresets.filter((p) => p.id !== id) });
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        aria-hidden
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[88svh] max-h-[88svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl px-3 border-t border-ink-800 bg-ink-900 pb-safe shadow-2xl animate-fade-in"
      >
      {/* The sheet opens on its drag handle, which doubles as the dismiss
          target: the reference has no title bar or close button here. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close settings"
        className="flex shrink-0 items-center justify-center py-3"
      >
        <span className="h-1 w-10 rounded-full bg-ink-700" aria-hidden />
      </button>

      {section !== null && (
        <div className="sticky top-0 z-10 flex shrink-0 items-center bg-ink-900 px-3 pb-1">
          <button
            type="button"
            onClick={() => setSection(null)}
            aria-label="Back to all settings"
            className="-ml-1.5 shrink-0 rounded-lg p-1.5 text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {storeError && (
        <p
          role="alert"
          className="shrink-0 border-b border-ink-800 bg-danger-soft px-4 py-2 text-xs text-danger sm:px-5"
        >
          {storeError}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {section === null ? (
            <OverviewNav onSelect={setSection} />
          ) : (
            <div className="px-3 py-4">
              <h2 className="mb-3 text-base font-semibold text-neutral-100">
                {SECTION_TITLES[section]}
              </h2>
              {section === "account" && <AccountDetail user={user} />}
              {section === "appearance" && <AppearanceSection compact />}
              {section === "behavior" && <BehaviorSection />}
              {section === "customize" && (
                <div className="space-y-6">
                  <Section>
                    <div>
                      <p className="mb-2 text-xs font-medium text-neutral-400">Start from a preset</p>
                      <div className="flex flex-wrap gap-2">
                        {presets.map((preset) => {
                          const applied = globalPrompt.trim() === preset.prompt.trim();
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setGlobalPrompt(preset.prompt)}
                              aria-pressed={applied}
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs transition",
                                applied
                                  ? "border-neutral-400 bg-ink-700 text-neutral-100"
                                  : "border-ink-700 text-neutral-400 hover:border-ink-600 hover:text-neutral-200",
                              )}
                            >
                              {preset.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="global-instructions"
                        className="mb-1.5 block text-xs font-medium text-neutral-400"
                      >
                        Global instructions
                      </label>
                      <textarea
                        id="global-instructions"
                        rows={6}
                        value={globalPrompt}
                        onChange={(e) => setGlobalPrompt(e.target.value)}
                        placeholder="e.g. Be concise. Prefer bullet points. I work mostly in TypeScript."
                        className={cn(inputClass, "resize-y")}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="chat-instructions"
                        className="mb-1.5 block text-xs font-medium text-neutral-400"
                      >
                        This chat only
                      </label>
                      {activeChat ? (
                        <textarea
                          id="chat-instructions"
                          rows={4}
                          value={chatPrompt}
                          onChange={(e) => setChatPrompt(e.target.value)}
                          placeholder={`Extra instructions that apply only to “${activeChat.title}”.`}
                          className={cn(inputClass, "resize-y")}
                        />
                      ) : (
                        <p className="rounded-xl border border-dashed border-ink-700 px-3.5 py-3 text-xs text-neutral-500">
                          Start a chat first to add instructions that apply to it alone.
                        </p>
                      )}
                    </div>
                  </Section>

                  <PresetsSection
                    presets={presets}
                    newPreset={newPreset}
                    setNewPreset={setNewPreset}
                    onAdd={addPreset}
                    onRemove={removePreset}
                  />

                  <Section>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label
                          htmlFor="default-model"
                          className="mb-1.5 block text-xs font-medium text-neutral-400"
                        >
                          Default model
                        </label>
                        <select
                          id="default-model"
                          value={`${defaults.provider}:${defaults.model}`}
                          onChange={(e) => {
                            const [provider, ...rest] = e.target.value.split(":");
                            setDefaults((d) => ({ ...d, provider, model: rest.join(":") }));
                          }}
                          className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-neutral-100 focus:border-ink-600 sm:text-sm"
                        >
                          {available.length === 0 && (
                            <option value={`${DEFAULT_PROVIDER}:${DEFAULT_MODEL}`}>
                              Auto — no provider configured
                            </option>
                          )}
                          {available.map((entry) => (
                            <optgroup key={entry.id} label={entry.label}>
                              {entry.models.map((m) => (
                                <option key={m.id} value={`${entry.id}:${m.id}`}>
                                  {m.label}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          htmlFor="temperature"
                          className="mb-1.5 block text-xs font-medium text-neutral-400"
                        >
                          Temperature ·{" "}
                          <span className="text-neutral-300">{defaults.temperature.toFixed(2)}</span>
                        </label>
                        <input
                          id="temperature"
                          type="range"
                          min={0}
                          max={2}
                          step={0.05}
                          value={defaults.temperature}
                          onChange={(e) =>
                            setDefaults((d) => ({ ...d, temperature: Number(e.target.value) }))
                          }
                          className="w-full accent-neutral-200"
                        />
                        <p className="mt-1 text-[11px] text-neutral-600">
                          Lower is focused, higher is creative.
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor="max-tokens"
                          className="mb-1.5 block text-xs font-medium text-neutral-400"
                        >
                          Max tokens
                        </label>
                        <input
                          id="max-tokens"
                          type="number"
                          min={128}
                          max={32768}
                          step={128}
                          value={defaults.maxTokens}
                          onChange={(e) =>
                            setDefaults((d) => ({
                              ...d,
                              maxTokens: Math.min(
                                32768,
                                Math.max(128, Number(e.target.value) || 128),
                              ),
                            }))
                          }
                          className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 text-base text-neutral-100 focus:border-ink-600 sm:text-sm"
                        />
                        <p className="mt-1 text-[11px] text-neutral-600">
                          Upper bound on a single response.
                        </p>
                      </div>
                    </div>
                  </Section>
                </div>
              )}
              {section === "data" && <DataSection />}
            </div>
          )}
        </div>

        {section === "customize" && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ink-800 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-3.5 py-2 text-sm text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={persist}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save changes
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

/** The settings overview: a compact, grouped list where every row has a chevron. */
function OverviewNav({ onSelect }: { onSelect: (id: SectionId) => void }) {
  return (
    <nav aria-label="Settings sections" className="px-3 pb-4 pt-1">
      {GROUPS.map((group) => (
        <section key={group.group} className="mb-5 last:mb-0">
          <h3 className="px-2 pb-1 text-[11px] font-medium text-neutral-600">{group.group}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-ink-850 focus:bg-ink-850"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">
                    {item.label}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-neutral-600 transition group-hover:text-neutral-400"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/**
 * The Account detail view: identity at the top, then the editable profile
 * fields (name, nickname, email) backed by Supabase.
 */
function AccountDetail({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"name" | "nickname" | "email" | null>(null);
  const [name, setName] = useState(user.displayName);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEditing(null);
    setName(user.displayName);
    setNickname(user.nickname ?? "");
    setEmail(user.email);
  }

  // Nickname lives on the same profiles row as the display name.
  async function saveNickname() {
    const value = nickname.trim();
    if (value === (user.nickname ?? "")) return reset();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await createClient()
      .from("profiles")
      .update({ nickname: value || null })
      .eq("id", user.userId);
    setBusy(false);
    if (updateError) {
      console.error("[ugnay] Could not update the nickname:", updateError);
      setError("Could not update your nickname. Please try again.");
      return;
    }
    setEditing(null);
    setNotice(value ? "Nickname updated." : "Nickname cleared.");
    router.refresh();
  }

  async function saveName() {
    const value = name.trim();
    if (!value || value === user.displayName) return reset();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await createClient()
      .from("profiles")
      .update({ display_name: value })
      .eq("id", user.userId);
    setBusy(false);
    if (updateError) {
      console.error("[ugnay] Could not update the display name:", updateError);
      setError("Could not update your name. Please try again.");
      return;
    }
    setEditing(null);
    setNotice("Name updated.");
    router.refresh();
  }

  async function saveEmail() {
    const value = email.trim();
    if (!value || value === user.email) return reset();
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: updateError } = await createClient().auth.updateUser({ email: value });
    setBusy(false);
    if (updateError) {
      console.error("[ugnay] Could not update the email address:", updateError);
      setError(updateError.message || "Could not update your email. Please try again.");
      return;
    }
    setEditing(null);
    setNotice("Check your inbox to confirm the new email address.");
  }

  return (
    <div>
      <div className="flex items-center gap-3 rounded-xl border border-ink-800 bg-ink-900/60 px-4 py-3.5">
        <UserAvatar name={user.displayName} src={user.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-100">{user.displayName}</p>
          <p className="truncate text-xs text-neutral-500">{user.email}</p>
        </div>
      </div>

      <div className="mt-4">
        <Row label="Full name" icon={User}>
          {editing === "name" ? (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
              <label htmlFor="account-name" className="sr-only">
                Full name
              </label>
              <input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-44 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-ink-600"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveName()} disabled={busy} className={actionClass}>
                  Save
                </button>
                <button type="button" onClick={reset} className={cn(actionClass, "border-transparent")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="truncate text-sm text-neutral-400">{user.displayName}</span>
              <button type="button" onClick={() => setEditing("name")} className={rowActionClass}>
                  Edit
              </button>
            </>
          )}
        </Row>

        <Row label="Nickname" icon={AtSign}>
          {editing === "nickname" ? (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
              <label htmlFor="account-nickname" className="sr-only">
                Nickname
              </label>
              <input
                id="account-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="What should Ugnay call you?"
                className="w-44 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveNickname()}
                  disabled={busy}
                  className={actionClass}
                >
                  Save
                </button>
                <button type="button" onClick={reset} className={cn(actionClass, "border-transparent")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="truncate text-sm text-neutral-400">
                {user.nickname ?? "Not set"}
              </span>
              <button type="button" onClick={() => setEditing("nickname")} className={rowActionClass}>
                  Edit
              </button>
            </>
          )}
        </Row>

        <Row label="Email" icon={Mail}>
          {editing === "email" ? (
            <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
              <label htmlFor="account-email" className="sr-only">
                Email address
              </label>
              <input
                id="account-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-56 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-ink-600"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveEmail()} disabled={busy} className={actionClass}>
                  Save
                </button>
                <button type="button" onClick={reset} className={cn(actionClass, "border-transparent")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="truncate text-sm text-neutral-400">{user.email}</span>
              <button type="button" onClick={() => setEditing("email")} className={rowActionClass}>
                Edit
              </button>
            </>
          )}
        </Row>

        <Row label="Subscription" icon={CreditCard}>
          <span className="truncate text-sm text-neutral-400">Manage your Ugnay subscription</span>
          <span
            aria-disabled
            className="flex h-9 w-28 shrink-0 items-center justify-center rounded-full border border-ink-800 text-xs text-neutral-600 sm:h-8 sm:w-32"
          >
            Manage
          </span>
        </Row>
      </div>

      {notice && (
        <p role="status" className="pt-3 text-xs text-success">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="pt-3 text-xs text-danger">
          {error}
        </p>
      )}

      <AccountDangerZone />
    </div>
  );
}
