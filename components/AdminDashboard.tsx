"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Cpu,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MessagesSquare,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
} from "lucide-react";
import AdminModelsSection, {
  AdminAiSettingsSection,
  AdminHealthSection,
} from "./AdminModelsView";
import { cn } from "@/lib/utils";

/** Shape of GET /api/admin/overview — every number comes from the database. */
interface Overview {
  users?: { total: number; admins: number; new_7d: number };
  conversations?: {
    chats: number;
    messages: number;
    messages_7d: number;
    projects: number;
    shared: number;
    by_model: Array<{ provider: string; model: string; messages: number; total_tokens: number }>;
  };
  knowledge?: { files: number; indexed: number; failed: number; chunks: number; embeddings: number };
  training?: {
    messages: number;
    conversations: number;
    last_collected_at: string | null;
    opted_in: number;
  };
  feedback?: { app: number; up: number; down: number };
  audit?: Array<{
    provider_id: string;
    model_id: string;
    status: string;
    priority: number;
    updated_at: string;
    updated_by: string | null;
  }>;
}

const SECTIONS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "models", label: "AI Models", icon: Cpu },
  { id: "conversations", label: "Conversations", icon: MessagesSquare },
  { id: "knowledge", label: "Knowledge", icon: BookOpen },
  { id: "training", label: "Training", icon: GraduationCap },
  { id: "health", label: "System Health", icon: ShieldCheck },
  { id: "audit", label: "Audit Logs", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const rowClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition";

/** The site/AI switches and the model roster, for the overview strip. */
interface ModelsPayload {
  providers?: Array<{
    id: string;
    configured: boolean;
    status: string;
    models: Array<{ status: string; available: boolean }>;
  }>;
  settings?: { maintenance?: boolean; siteMaintenance?: boolean };
}

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  loading,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-xs text-neutral-500">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        {label}
      </span>
      {loading ? (
        <span className="mt-2 block h-7 w-16 animate-pulse rounded bg-ink-850" />
      ) : (
        <span className="mt-1.5 block font-display text-2xl font-semibold text-neutral-100">
          {value}
        </span>
      )}
      {hint && !loading && <span className="mt-1 block text-[11px] text-neutral-600">{hint}</span>}
    </>
  );

  const className = cn(
    cardClass,
    "block text-left transition",
    onClick && "hover:border-ink-700 hover:bg-ink-850",
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** One line of system status: a dot, what it is, and where it stands. */
function StatusPill({
  label,
  state,
  tone,
  onClick,
}: {
  label: string;
  state: string;
  tone: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-ink-800 bg-ink-900 px-3.5 py-2.5 text-left transition",
        onClick && "hover:border-ink-700 hover:bg-ink-850",
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", tone)} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{label}</span>
      <span className="shrink-0 text-xs text-neutral-200">{state}</span>
    </button>
  );
}

/** Models a request could actually be routed to right now. */
function availableModels(models: ModelsPayload) {
  return (
    models.providers
      ?.filter((p) => p.configured && p.status === "available")
      .flatMap((p) => p.models)
      .filter((m) => m.status === "available" && m.available).length ?? 0
  );
}

/** The places an admin goes straight after looking at the overview. */
const QUICK_ACTIONS = [
  { id: "models", label: "Manage AI models", icon: Cpu },
  { id: "health", label: "Check system health", icon: ShieldCheck },
  { id: "settings", label: "Maintenance settings", icon: SettingsIcon },
] as const;

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-neutral-600">{children}</p>;
}

/**
 * The unified admin dashboard. One page, the sections along the side, exactly
 * the shell the rest of Ugnay uses: ink surfaces, rounded cards, a rail that
 * collapses to a scrolling row on a phone.
 *
 * Every figure comes from public.admin_overview() (guarded by is_admin() in
 * the database) or from /api/admin/models; nothing here is invented.
 */
export default function AdminDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("section") as SectionId | null;
  const [section, setSection] = useState<SectionId>(
    SECTIONS.some((s) => s.id === requested) ? (requested as SectionId) : "overview",
  );
  const [data, setData] = useState<Overview | null>(null);
  const [models, setModels] = useState<ModelsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = !data;

  useEffect(() => {
    if (requested && SECTIONS.some((s) => s.id === requested)) setSection(requested);
  }, [requested]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load the dashboard figures.");
        return;
      }
      setData(await res.json());
    })();

    void (async () => {
      const res = await fetch("/api/admin/models", { cache: "no-store" });
      if (res.ok) setModels(await res.json());
    })();
  }, []);

  function open(id: SectionId) {
    setSection(id);
    router.replace(id === "overview" ? "/admin" : `/admin?section=${id}`, { scroll: false });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950 md:flex-row">
      {/* Section rail — the sidebar's visual language, without its state. */}
      <aside className="shrink-0 border-b border-ink-800 md:w-60 md:border-b-0 md:border-r">
        <div className="px-2 pt-safe md:px-3">
          <Link
            href="/"
            className="mt-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to Ugnay
          </Link>
          <h2 className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-neutral-600">
            Admin
          </h2>
          <nav
            aria-label="Admin sections"
            className="flex gap-1 overflow-x-auto pb-3 md:flex-col md:space-y-0.5 md:overflow-visible md:pb-6"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => open(id)}
                aria-current={section === id ? "page" : undefined}
                className={cn(
                  rowClass,
                  "shrink-0 md:w-full",
                  section === id
                    ? "bg-ink-800 text-neutral-100"
                    : "text-neutral-300 hover:bg-ink-850 hover:text-neutral-100",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 pb-24 pt-6 sm:px-8 md:pt-10">
          {error && (
            <p
              role="alert"
              className="mt-6 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs text-danger"
            >
              {error}
            </p>
          )}

          <div>
            {section === "overview" && (
              <div className="space-y-6">
                {/* System status first: what is on, what is off. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <StatusPill
                    label="Ugnay AI chat"
                    state={models?.settings?.maintenance ? "Offline" : "Online"}
                    tone={models?.settings?.maintenance ? "bg-amber-400" : "bg-emerald-400"}
                    onClick={() => open("settings")}
                  />
                  <StatusPill
                    label="Site"
                    state={models?.settings?.siteMaintenance ? "Maintenance" : "Online"}
                    tone={models?.settings?.siteMaintenance ? "bg-danger" : "bg-emerald-400"}
                    onClick={() => open("settings")}
                  />
                  <StatusPill
                    label="Models answering"
                    state={models ? `${availableModels(models)} available` : "—"}
                    tone="bg-accent"
                    onClick={() => open("models")}
                  />
                </div>

                {/* The numbers that matter, each a way into its section. */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  <Stat
                    icon={Users}
                    label="Accounts"
                    value={data?.users?.total ?? "—"}
                    hint={data?.users ? `${data.users.new_7d} new this week` : undefined}
                    loading={loading}
                  />
                  <Stat
                    icon={MessagesSquare}
                    label="Messages"
                    value={data?.conversations?.messages ?? "—"}
                    hint={
                      data?.conversations ? `${data.conversations.messages_7d} this week` : undefined
                    }
                    loading={loading}
                    onClick={() => open("conversations")}
                  />
                  <Stat
                    icon={MessagesSquare}
                    label="Conversations"
                    value={data?.conversations?.chats ?? "—"}
                    loading={loading}
                    onClick={() => open("conversations")}
                  />
                  <Stat
                    icon={BookOpen}
                    label="Knowledge files"
                    value={data?.knowledge?.files ?? "—"}
                    hint={data?.knowledge ? `${data.knowledge.indexed} indexed` : undefined}
                    loading={loading}
                    onClick={() => open("knowledge")}
                  />
                  <Stat
                    icon={GraduationCap}
                    label="Training rows"
                    value={data?.training?.messages ?? "—"}
                    loading={loading}
                    onClick={() => open("training")}
                  />
                  <Stat
                    icon={ShieldCheck}
                    label="Admins"
                    value={data?.users?.admins ?? "—"}
                    loading={loading}
                  />
                </div>

                {/* What changed lately, and the two places an admin goes next. */}
                <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                  <section className={cardClass}>
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-medium text-neutral-100">Recent changes</h2>
                      <button
                        type="button"
                        onClick={() => open("audit")}
                        className="text-xs text-neutral-500 transition hover:text-neutral-200"
                      >
                        View all
                      </button>
                    </div>
                    {loading ? (
                      <div className="mt-3 space-y-2" aria-busy="true">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-10 animate-pulse rounded-xl bg-ink-850" />
                        ))}
                      </div>
                    ) : (data?.audit ?? []).length ? (
                      <ul className="mt-3 space-y-2">
                        {(data?.audit ?? []).slice(0, 4).map((a) => (
                          <li
                            key={`${a.provider_id}:${a.model_id}:${a.updated_at}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5"
                          >
                            <span className="min-w-0 truncate text-sm text-neutral-100">
                              {a.model_id || `${a.provider_id} (whole provider)`}
                              <span className="ml-2 text-[11px] text-neutral-500">{a.status}</span>
                            </span>
                            <span className="shrink-0 text-[11px] text-neutral-600">
                              {new Date(a.updated_at).toLocaleDateString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 text-xs leading-relaxed text-neutral-600">
                        No model overrides have been made yet. Changes you make in AI Models show
                        up here.
                      </p>
                    )}
                  </section>

                  <section className={cardClass}>
                    <h2 className="text-sm font-medium text-neutral-100">Quick actions</h2>
                    <div className="mt-3 space-y-2">
                      {QUICK_ACTIONS.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => open(id)}
                          className="flex w-full items-center gap-2.5 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5 text-left text-sm text-neutral-200 transition hover:border-ink-700 hover:bg-ink-850"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {section === "models" && <AdminModelsSection />}

            {section === "conversations" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Chats" value={data?.conversations?.chats ?? "—"} loading={loading} />
                  <Stat
                    label="Messages"
                    value={data?.conversations?.messages ?? "—"}
                    loading={loading}
                  />
                  <Stat
                    label="Workspaces"
                    value={data?.conversations?.projects ?? "—"}
                    loading={loading}
                  />
                  <Stat
                    label="Active shares"
                    value={data?.conversations?.shared ?? "—"}
                    loading={loading}
                  />
                </div>
                <section className={cardClass}>
                  <h2 className="text-sm font-medium text-neutral-100">Replies by model</h2>
                  <ul className="mt-3 space-y-2">
                    {(data?.conversations?.by_model ?? []).map((m) => (
                      <li
                        key={`${m.provider}:${m.model}`}
                        className="flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5"
                      >
                        <span className="min-w-0 truncate text-sm text-neutral-100">
                          {m.model}
                          <span className="ml-2 text-[11px] text-neutral-600">{m.provider}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-neutral-500">
                          {m.messages} replies · {m.total_tokens} tokens
                        </span>
                      </li>
                    ))}
                    {!data?.conversations?.by_model?.length && <Empty>No replies yet.</Empty>}
                  </ul>
                </section>
              </div>
            )}

            {section === "knowledge" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Files" value={data?.knowledge?.files ?? "—"} loading={loading} />
                <Stat label="Indexed" value={data?.knowledge?.indexed ?? "—"} loading={loading} />
                <Stat
                  label="Failed to index"
                  value={data?.knowledge?.failed ?? "—"}
                  loading={loading}
                />
                <Stat label="Passages" value={data?.knowledge?.chunks ?? "—"} loading={loading} />
                <Stat
                  label="Message vectors"
                  value={data?.knowledge?.embeddings ?? "—"}
                  loading={loading}
                />
              </div>
            )}

            {section === "training" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Preserved turns"
                    value={data?.training?.messages ?? "—"}
                    loading={loading}
                  />
                  <Stat
                    label="Conversations"
                    value={data?.training?.conversations ?? "—"}
                    loading={loading}
                  />
                  <Stat
                    label="Accounts opted in"
                    value={data?.training?.opted_in ?? "—"}
                    loading={loading}
                  />
                </div>
                <p className="text-xs leading-relaxed text-neutral-500">
                  Turns are copied into the training dataset when an opted-in account
                  is deleted; the copy carries no account-identifying fields and is
                  not used for live replies.
                  {data?.training?.last_collected_at &&
                    ` Last collected ${new Date(data.training.last_collected_at).toLocaleString()}.`}
                </p>
              </div>
            )}

            {section === "health" && <AdminHealthSection />}

            {section === "audit" && (
              <section className={cardClass}>
                <h2 className="text-sm font-medium text-neutral-100">Recent model changes</h2>
                <ul className="mt-3 space-y-2">
                  {(data?.audit ?? []).map((a) => (
                    <li
                      key={`${a.provider_id}:${a.model_id}:${a.updated_at}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5"
                    >
                      <span className="min-w-0 truncate text-sm text-neutral-100">
                        {a.model_id || `${a.provider_id} (whole provider)`}
                        <span className="ml-2 text-[11px] text-neutral-500">
                          {a.status} · priority {a.priority}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-neutral-600">
                        {a.updated_by ? `${a.updated_by} · ` : ""}
                        {new Date(a.updated_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                  {!data?.audit?.length && <Empty>No model overrides have been made yet.</Empty>}
                </ul>
              </section>
            )}

            {section === "settings" && <AdminAiSettingsSection />}
          </div>
        </div>
      </main>
    </div>
  );
}
