"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

/** Mirrors the payload of GET /api/admin/models. */
type Status = "available" | "disabled" | "maintenance";

interface ModelRow {
  id: string;
  label: string;
  description: string | null;
  free: boolean;
  status: Status;
  priority: number;
  available: boolean;
  latencyMs: number | null;
  failures: number;
  lastErrorAt: number | null;
  lastErrorStatus: number | null;
  lastOkAt: number | null;
}

interface ProviderRow {
  id: string;
  label: string;
  configured: boolean;
  status: Status;
  models: ModelRow[];
}

const STATUSES: Status[] = ["available", "disabled", "maintenance"];

/** The four states a model can be in, as the admin sees them. */
function stateOf(provider: ProviderRow, model: ModelRow) {
  if (!provider.configured) return { label: "Unavailable", tone: "text-neutral-500" };
  if (provider.status === "disabled" || model.status === "disabled")
    return { label: "Disabled", tone: "text-neutral-400" };
  if (provider.status === "maintenance" || model.status === "maintenance")
    return { label: "Maintenance", tone: "text-amber-400" };
  if (!model.available) return { label: "Unavailable", tone: "text-danger" };
  return { label: "Available", tone: "text-emerald-400" };
}

const selectClass =
  "rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs text-neutral-200 focus:border-ink-600";
const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const fieldClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600";

/** timestamptz -> the value a datetime-local input expects, in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Shared loader for every admin surface that reads the model registry. */
function useAdminModels() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [maintenance, setMaintenance] = useState(false);
  const [message, setMessage] = useState("");
  const [siteMaintenance, setSiteMaintenance] = useState(false);
  const [siteMessage, setSiteMessage] = useState("");
  /** datetime-local value ("YYYY-MM-DDTHH:mm"), empty when no estimate. */
  const [siteBackAt, setSiteBackAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/admin/models", { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load the models.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setProviders(data.providers ?? []);
    setMaintenance(Boolean(data.settings?.maintenance));
    setMessage(data.settings?.message ?? "");
    setSiteMaintenance(Boolean(data.settings?.siteMaintenance));
    setSiteMessage(data.settings?.siteMessage ?? "");
    setSiteBackAt(toLocalInput(data.settings?.siteBackAt ?? null));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (path: "PATCH" | "POST", body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      const res = await apiFetch("/api/admin/models", {
        method: path,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) setError("Could not save the change.");
      await load();
      setBusy(false);
    },
    [load],
  );

  return {
    providers,
    maintenance,
    message,
    setMessage,
    siteMaintenance,
    siteMessage,
    setSiteMessage,
    siteBackAt,
    setSiteBackAt,
    loading,
    busy,
    error,
    save,
  };
}

/** A quiet pill in the corner rather than a line that shifts the page. */
function Saving({ busy }: { busy: boolean }) {
  if (!busy) return null;
  return (
    <p
      role="status"
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-ink-700 bg-ink-850/95 px-3 py-1.5 text-xs text-neutral-300 shadow-lg animate-fade-in"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" aria-hidden />
      Saving
    </p>
  );
}

function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs text-danger"
    >
      {error}
    </p>
  );
}

/**
 * AI Models: availability, maintenance and routing priority for every
 * configured provider. Automatic routing only picks models that are enabled,
 * not under maintenance, and currently responding; a model the user chose is
 * never swapped, so disabling it returns a clear error instead.
 */
export default function AdminModelsSection() {
  const { providers, loading, busy, error, save } = useAdminModels();

  return (
    <div>
      <ErrorNote error={error} />

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-ink-900" aria-busy="true" />
      ) : (
        /* One card for every provider: a header row per provider, its models
         * listed under it, divided rather than boxed separately. */
        <section className={cn(cardClass, "divide-y divide-ink-800 p-0")}>
          {providers.map((provider) => (
            <div key={provider.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-neutral-100">{provider.label}</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {provider.configured ? "Configured" : "No API key on the server"}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                  Provider
                  <select
                    value={provider.status}
                    disabled={busy}
                    onChange={(e) =>
                      void save("PATCH", {
                        providerId: provider.id,
                        modelId: "",
                        status: e.target.value,
                      })
                    }
                    className={selectClass}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s === "available" ? "enabled" : s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <ul className="mt-3 divide-y divide-ink-800/70">
                {provider.models.map((model) => {
                  const state = stateOf(provider, model);
                  return (
                    <li
                      key={model.id}
                      className="flex flex-wrap items-center gap-3 py-2.5 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-neutral-100">
                          {model.label}
                        </span>
                        {model.description && (
                          <span className="mt-0.5 block truncate text-xs text-neutral-400">
                            {model.description}
                          </span>
                        )}
                        <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                          <span className={state.tone}>{state.label}</span>
                          {model.latencyMs !== null && ` \u00b7 ${model.latencyMs} ms last reply`}
                          {model.failures > 0 &&
                            ` \u00b7 ${model.failures} recent failure${model.failures === 1 ? "" : "s"}`}
                          {model.lastErrorStatus !== null && ` (HTTP ${model.lastErrorStatus})`}
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        Priority
                        <input
                          type="number"
                          defaultValue={model.priority}
                          disabled={busy}
                          onBlur={(e) =>
                            void save("PATCH", {
                              providerId: provider.id,
                              modelId: model.id,
                              priority: Number(e.target.value) || 0,
                            })
                          }
                          className="w-16 rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-neutral-200 focus:border-ink-600"
                        />
                      </label>
                      <select
                        value={model.status}
                        disabled={busy}
                        onChange={(e) =>
                          void save("PATCH", {
                            providerId: provider.id,
                            modelId: model.id,
                            status: e.target.value,
                          })
                        }
                        className={selectClass}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s === "available" ? "enabled" : s}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <Saving busy={busy} />
    </div>
  );
}

/** System Health: the live routing record, read-only. */
export function AdminHealthSection() {
  const { providers, loading, error } = useAdminModels();
  const rows = providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));

  return (
    <div>
      <ErrorNote error={error} />
      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl bg-ink-900" aria-busy="true" />
      ) : (
        <div className={cn(cardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="text-neutral-500">
              <tr>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Last reply</th>
                <th className="pb-2 font-medium">Failures</th>
                <th className="pb-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              {rows.map(({ provider, model }) => {
                const state = stateOf(provider, model);
                return (
                  <tr key={`${provider.id}:${model.id}`} className="border-t border-ink-800">
                    <td className="py-2 pr-3">
                      <span className="text-neutral-100">{model.label}</span>
                      <span className="ml-2 text-neutral-600">{provider.label}</span>
                    </td>
                    <td className={cn("py-2 pr-3", state.tone)}>{state.label}</td>
                    <td className="py-2 pr-3">
                      {model.latencyMs !== null ? `${model.latencyMs} ms` : "—"}
                    </td>
                    <td className="py-2 pr-3">{model.failures}</td>
                    <td className="py-2">
                      {model.lastErrorAt
                        ? `${new Date(model.lastErrorAt).toLocaleTimeString()}${
                            model.lastErrorStatus ? ` · HTTP ${model.lastErrorStatus}` : ""
                          }`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Settings: the AI switch, and the switch that takes the whole site offline. */
export function AdminAiSettingsSection() {
  const {
    maintenance,
    message,
    setMessage,
    siteMaintenance,
    siteMessage,
    setSiteMessage,
    siteBackAt,
    setSiteBackAt,
    loading,
    busy,
    error,
    save,
  } = useAdminModels();

  const saveSite = (patch: Record<string, unknown> = {}) =>
    void save("POST", {
      siteMaintenance,
      siteMessage,
      siteBackAt: siteBackAt || null,
      ...patch,
    });

  return (
    <div>
      <ErrorNote error={error} />

      {/* One card, one row per setting: label and note on the left, the
        * control on the right, so every control lines up down the page. */}
      <section className={cn(cardClass, "divide-y divide-ink-800 p-0")}>
        <Row
          title="AI maintenance"
          note="Turns Ugnay AI chat off for everyone. Replies are refused until it is back on."
          state={maintenance ? "Offline" : "Online"}
          tone={maintenance ? "text-amber-400" : "text-emerald-400"}
        >
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void save("POST", { maintenance: !maintenance, message })}
            className={cn(actionClass, maintenance ? onClass : offClass)}
          >
            {maintenance ? "Turn AI on" : "Turn AI off"}
          </button>
        </Row>

        <Row title="AI message" note="Shown in chat while AI is offline.">
          <input
            aria-label="Message shown while AI is offline"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => void save("POST", { maintenance, message })}
            placeholder="Ugnay AI is temporarily unavailable for maintenance."
            className={cn(fieldClass, "sm:w-72")}
          />
        </Row>

        <Row
          title="Site maintenance"
          note="Takes the whole of Ugnay offline. Only admins keep working."
          state={siteMaintenance ? "Offline" : "Online"}
          tone={siteMaintenance ? "text-danger" : "text-emerald-400"}
        >
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => saveSite({ siteMaintenance: !siteMaintenance })}
            className={cn(actionClass, siteMaintenance ? dangerOnClass : offClass)}
          >
            {siteMaintenance ? "Bring the site back" : "Take the site offline"}
          </button>
        </Row>

        <Row title="Maintenance message" note="Optional line under the heading.">
          <input
            aria-label="Message on the maintenance screen"
            value={siteMessage}
            onChange={(e) => setSiteMessage(e.target.value)}
            onBlur={() => saveSite()}
            placeholder="Scheduled maintenance is currently in progress."
            className={cn(fieldClass, "sm:w-72")}
          />
        </Row>

        <Row title="Expected back" note="Optional. Shown as a date and time on the screen.">
          <input
            aria-label="Expected back"
            type="datetime-local"
            value={siteBackAt}
            onChange={(e) => setSiteBackAt(e.target.value)}
            onBlur={() => saveSite()}
            className={cn(fieldClass, "sm:w-72")}
          />
        </Row>

        <Row
          title="Clear the estimate"
          note="Removes the expected-back time from the maintenance screen."
        >
          <button
            type="button"
            disabled={busy || loading || !siteBackAt}
            onClick={() => {
              setSiteBackAt("");
              saveSite({ siteBackAt: null });
            }}
            className={cn(actionClass, offClass)}
          >
            Clear
          </button>
        </Row>
      </section>

      <Saving busy={busy} />
    </div>
  );
}

const actionClass =
  "w-full shrink-0 rounded-lg px-3.5 py-2 text-xs font-medium transition disabled:opacity-60 sm:w-auto";
const offClass = "border border-ink-700 text-neutral-300 hover:bg-ink-850";
const onClass = "bg-amber-400 text-ink-950 hover:opacity-90";
const dangerOnClass = "bg-danger text-ink-950 hover:opacity-90";

/** One setting: text on the left, its control right-aligned on the same line. */
function Row({
  title,
  note,
  state,
  tone,
  children,
}: {
  title: string;
  note: string;
  state?: string;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-neutral-100">
          {title}
          {state && <span className={cn("ml-2 text-[11px] font-normal", tone)}>{state}</span>}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">{note}</p>
      </div>
      <div className="shrink-0 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}
