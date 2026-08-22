"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  CreditCard,
  Database,
  Loader2,
  Mail,
  Palette,
  Plus,
  Settings,
  SlidersHorizontal,
  MessageSquareText,
  User,
  X,
} from "lucide-react";
import Modal from "./Modal";
import UserAvatar from "./UserAvatar";
import AccountDangerZone from "./AccountDangerZone";
import type { CurrentUser } from "./ChatApp";
import { createClient } from "@/lib/supabase/client";
import { CURRENT_PLAN, PLANS } from "@/lib/plans";
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
  pillClass,
  rowActionClass,
} from "./SettingsSections";
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

/**
 * The single settings surface: account, appearance, behavior, the Customize
 * Ugnay controls (instructions, modes, model defaults) and data controls.
 */
export default function SettingsPanelDesktop({
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
          <p role="alert" className="mx-4 mb-2 shrink-0 text-xs text-danger sm:mx-5">
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
        <button
          type="button"
          onClick={onManage}
          className={cn(pillClass, "flex items-center gap-1.5")}
        >
          <Settings className="h-3.5 w-3.5 text-neutral-400" aria-hidden />
          Manage
        </button>
      </div>

      <div className="py-3">
        <div className="flex items-center gap-3">
          <BadgeCheck className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <p className="text-sm text-neutral-200">Plan</p>
          <p className="min-w-0 flex-1 truncate text-right text-sm text-neutral-400">
            {currentPlan?.name ?? "Ugnay Free"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 py-3">
        <CalendarDays className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
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

  function reset() {
    setEditing(null);
    setName(user.displayName);
    setNickname(user.nickname ?? "");
    setEmail(user.email);
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

  return (
    <div>
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
