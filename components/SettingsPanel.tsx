"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  Database,
  Loader2,
  Palette,
  Plus,
  SlidersHorizontal,
  Sparkles,
  MessageSquareText,
  Trash2,
  User,
  X,
} from "lucide-react";
import Modal from "./Modal";
import UserAvatar from "./UserAvatar";
import type { CurrentUser } from "./ChatApp";
import { createClient } from "@/lib/supabase/client";
import { CURRENT_PLAN, PLANS } from "@/lib/plans";
import { applyTheme, THEME_STORAGE_KEY, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { allPresets, useChatStore, DEFAULT_MODEL, DEFAULT_PROVIDER } from "@/store/chatStore";
import type { Preset } from "@/types/db";

type SectionId = "account" | "appearance" | "behavior" | "customize" | "data";

const NAV: { group: string; items: { id: SectionId; label: string; icon: typeof User }[] }[] = [
  {
    group: "General",
    items: [
      { id: "account", label: "Account", icon: User },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "behavior", label: "Behavior", icon: MessageSquareText },
    ],
  },
  {
    group: "Ugnay",
    items: [{ id: "customize", label: "Customize", icon: SlidersHorizontal }],
  },
  {
    group: "Data & Information",
    items: [{ id: "data", label: "Data Controls", icon: Database }],
  },
];

const SECTION_TITLES: Record<SectionId, string> = {
  account: "Account",
  appearance: "Appearance",
  behavior: "Behavior",
  customize: "Customize Ugnay",
  data: "Data Controls",
};

const pillClass =
  "shrink-0 rounded-full border border-ink-700 bg-ink-850 px-3.5 py-1.5 text-xs text-neutral-200 transition hover:bg-ink-800";

// One shared right-hand control column, so switches, dropdowns and buttons all
// end on the same edge no matter how long the label or description is.
const settingRowClass =
  "flex items-start justify-between gap-3 border-b border-ink-800 py-3 last:border-b-0 sm:gap-4";
const controlSlotClass = "flex w-28 shrink-0 items-center justify-end pt-0.5 sm:w-32";

const rowActionClass =
  "flex h-9 w-28 shrink-0 items-center justify-center rounded-full border border-ink-700 text-xs text-neutral-300 transition hover:bg-ink-800 disabled:opacity-60 sm:h-8 sm:w-32";

const actionClass =
  "shrink-0 rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-neutral-300 transition hover:bg-ink-800 disabled:opacity-60";

const inputClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-base leading-6 text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600 sm:text-sm";

/**
 * The single settings surface: account, appearance, behavior, the Customize
 * Ugnay controls (instructions, modes, model defaults) and data controls.
 */
export default function SettingsPanel({
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

  const [section, setSection] = useState<SectionId>("account");
  // Account has a nested "Your account" view reached from its Manage button.
  const [managingAccount, setManagingAccount] = useState(false);
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

  // Account is the default section every time the dialog opens.
  useEffect(() => {
    if (open) {
      setSection("account");
      setManagingAccount(false);
    }
  }, [open]);

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      hideHeader
      panelClassName="max-w-3xl h-[92dvh] sm:h-[560px]"
      contentClassName="flex min-h-0 flex-col overflow-hidden md:flex-row"
      footer={
        section === "customize" ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={persist}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-sm font-medium text-ink-950 hover:bg-white disabled:opacity-60"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Save changes
            </button>
          </>
        ) : undefined
      }
    >
      {/* Left navigation — a horizontal strip on mobile, a column from md up. */}
      <nav
        aria-label="Settings sections"
        className="shrink-0 overflow-x-auto overscroll-x-contain border-b border-ink-800 bg-ink-950/40 p-2 [-webkit-overflow-scrolling:touch] md:w-52 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r"
      >
        <div className="flex w-max gap-1 md:w-auto md:flex-col md:gap-0">
          {NAV.map((group) => (
            <div key={group.group} className="contents md:mt-4 md:block md:first:mt-0">
              <h3 className="hidden px-2.5 pb-1.5 text-[11px] font-medium text-neutral-500 md:block">
                {group.group}
              </h3>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSection(item.id);
                    setManagingAccount(false);
                  }}
                  aria-current={section === item.id ? "true" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-sm transition md:w-full",
                    section === item.id
                      ? "bg-ink-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-ink-850 hover:text-neutral-200",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                  {item.id === "account" && managingAccount ? "Your account" : item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      {/* Right pane — scrolls independently of the navigation. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-4 sm:gap-4 sm:px-5">
          <div className="min-w-0">
            {section === "account" && managingAccount ? (
              <>
                <button
                  type="button"
                  onClick={() => setManagingAccount(false)}
                  className="-ml-1 mb-1 flex items-center gap-1 rounded-lg px-1 py-0.5 text-xs text-neutral-500 hover:text-neutral-200"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  Account
                </button>
              </>
            ) : (
              <h2 className="text-base font-semibold text-neutral-100">{SECTION_TITLES[section]}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="shrink-0 rounded-lg p-2 sm:p-1.5 text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {storeError && (
          <p role="alert" className="mx-4 mb-2 shrink-0 text-xs text-red-400 sm:mx-5">
            {storeError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
          {section === "account" &&
            (managingAccount ? (
              <AccountDetails user={user} />
            ) : (
              <AccountSection user={user} onManage={() => setManagingAccount(true)} />
            ))}
          {section === "appearance" && <AppearanceSection />}
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
                          maxTokens: Math.min(32768, Math.max(128, Number(e.target.value) || 128)),
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
      </div>
    </Modal>
  );
}

function AccountSection({ user, onManage }: { user: CurrentUser; onManage: () => void }) {
  // The tier the account is actually on; paid plans have no checkout yet.
  const currentPlan = PLANS.find((plan) => plan.id === CURRENT_PLAN);
  const created = new Date(user.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? "Unknown"
    : created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="divide-y divide-ink-800">
      <div className="flex items-center gap-3 py-3">
        <UserAvatar name={user.displayName} src={user.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-neutral-100">{user.displayName}</p>
          <p className="truncate text-xs text-neutral-500">{user.email}</p>
        </div>
        <button type="button" onClick={onManage} className={pillClass}>
          Manage
        </button>
      </div>

      {/* Upgrade and nickname share one block, so no divider separates them. */}
      <div className="py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-sm text-neutral-200">Get Ugnay Plus</p>
          <Link href="/upgrade" className={pillClass}>
            Upgrade
          </Link>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <BadgeCheck className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <p className="text-sm text-neutral-200">Plan</p>
          <p className="min-w-0 flex-1 truncate text-right text-sm text-neutral-400">
            {currentPlan?.name ?? "Ugnay Free"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 py-3">
        <p className="text-sm text-neutral-200">Account created</p>
        <p className="min-w-0 flex-1 truncate text-right text-sm text-neutral-400">
          {createdLabel}
        </p>
      </div>
    </div>
  );
}

/**
 * "Your account": the details held on the authenticated Supabase user. Rendered only
 * by the dedicated Manage view, reached from the Account overview.
 */
function AccountDetails({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [editing, setEditing] = useState<"name" | "nickname" | "email" | null>(null);
  const [name, setName] = useState(user.displayName);
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const created = new Date(user.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? "Unknown"
    : created.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

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
      <Row label="Full name">
        {editing === "name" ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="account-name" className="sr-only">
              Full name
            </label>
            <input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-44 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-sm text-neutral-100 focus:border-ink-600"
            />
            <button type="button" onClick={() => void saveName()} disabled={busy} className={actionClass}>
              Save
            </button>
            <button type="button" onClick={reset} className={cn(actionClass, "border-transparent")}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="truncate text-sm text-neutral-400">{user.displayName}</span>
            <button type="button" onClick={() => setEditing("name")} className={rowActionClass}>
              Edit name
            </button>
          </>
        )}
      </Row>

      <Row label="Nickname">
        {editing === "nickname" ? (
          <div className="flex flex-wrap items-center gap-2">
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
        ) : (
          <>
            <span className="truncate text-sm text-neutral-400">
              {user.nickname ?? "Not set"}
            </span>
            <button type="button" onClick={() => setEditing("nickname")} className={rowActionClass}>
              Edit nickname
            </button>
          </>
        )}
      </Row>

      <Row label="Email">
        {editing === "email" ? (
          <div className="flex flex-wrap items-center gap-2">
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
            <button type="button" onClick={() => void saveEmail()} disabled={busy} className={actionClass}>
              Save
            </button>
            <button type="button" onClick={reset} className={cn(actionClass, "border-transparent")}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="truncate text-sm text-neutral-400">{user.email}</span>
            <button type="button" onClick={() => setEditing("email")} className={rowActionClass}>
              Update email
            </button>
          </>
        )}
      </Row>

      <Row label="Subscription">
        <span className="truncate text-sm text-neutral-400">Manage your Ugnay subscription</span>
        <span
          aria-disabled
          className="flex h-9 w-28 shrink-0 items-center justify-center rounded-full border border-ink-800 text-xs text-neutral-600 sm:h-8 sm:w-32"
        >
          Manage
        </span>
      </Row>

      <Row label="Account created">
        <span className="text-sm text-neutral-400">{createdLabel}</span>
      </Row>

      {notice && (
        <p role="status" className="pt-3 text-xs text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="pt-3 text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-800 py-3 last:border-b-0">
      <p className="w-full shrink-0 text-sm text-neutral-100 sm:w-32">{label}</p>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {children}
      </div>
    </div>
  );
}

function AppearanceSection() {
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
      <div className="grid gap-3 sm:grid-cols-3">
        {THEMES.map((option) => {
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => void choose(option.id)}
              aria-pressed={active}
              className={cn(
                "rounded-xl border p-2 text-left transition hover:border-ink-600",
                active ? "border-sky-500 ring-1 ring-sky-500/60" : "border-ink-700",
              )}
            >
              <ThemePreview id={option.id} />
              <span
                className={cn(
                  "mt-2 block px-1 text-xs",
                  active ? "text-neutral-100" : "text-neutral-400",
                )}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>

      <Toggle
        label="Wrap long lines for code blocks by default"
        hint="Wrap code instead of scrolling it horizontally."
        checked={settings?.wrap_code_lines ?? false}
        onChange={(v) => void saveSettings({ wrap_code_lines: v })}
      />
    </Section>
  );
}

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Inline SVG mock of a sidebar + message list, tinted for each theme. */
function ThemePreview({ id }: { id: ThemeChoice }) {
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

function PreviewBody({
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

function BehaviorSection() {
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
        <p role="alert" className="pb-2 text-xs text-red-400">
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

const DICTATION_OPTIONS: {
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
function PresetsSection({
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
                className="rounded p-1 text-neutral-500 hover:bg-ink-800 hover:text-red-400"
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

function DataSection() {
  const chats = useChatStore((s) => s.chats);
  const settings = useChatStore((s) => s.settings);
  const saveSettings = useChatStore((s) => s.saveSettings);
  const deleteChat = useChatStore((s) => s.deleteChat);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<null | "export" | "delete" | "cache">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <p role="alert" className="pb-3 text-xs text-red-300">
            Delete all {chats.length} conversations? This cannot be undone.{" "}
            <button
              type="button"
              onClick={() => setConfirmAll(false)}
              className="underline underline-offset-2 hover:text-red-200"
            >
              Cancel
            </button>
          </p>
        )}

        {notice && (
          <p role="status" className="pb-3 text-xs text-emerald-400">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="pb-3 text-xs text-red-400">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * One data-control row: title and description on the left, a single
 * fixed-size action button pinned to the right so every row lines up.
 */
function ActionRow({
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
            ? "border-red-900/70 text-red-300 hover:bg-red-950/40"
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
const FLAGS = {
  improve_model: true,
  personalize_with_history: true,
  share_links_enabled: true,
};

/**
 * Dropdown setting. The trigger is a rounded pill and each choice carries its
 * own explanation inside the popup, which opens upward and is positioned
 * `fixed` so it is never clipped by the scrolling settings pane.
 */
function SelectSetting<T extends string>({
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

function Toggle({
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

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="border-t border-ink-800 pt-6 first:border-0 first:pt-0">
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
