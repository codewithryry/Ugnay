import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin overrides on top of the provider registry: which models may answer,
 * which are down for maintenance, and the global AI switch. Rows are stored in
 * public.model_controls / public.ai_settings; a model with no row keeps the
 * behaviour it has always had, so an empty table changes nothing.
 */

export type ModelStatus = "available" | "disabled" | "maintenance";

export interface ModelControlRow {
  provider_id: string;
  /** Empty string means the row applies to the whole provider. */
  model_id: string;
  status: ModelStatus;
  priority: number;
  note: string | null;
  updated_at: string;
}

export interface AiSettingsRow {
  maintenance: boolean;
  message: string;
  /** Takes the whole app offline for everyone but an admin. */
  siteMaintenance: boolean;
  siteMessage: string;
  /** ISO timestamp the site is expected back, or null when none was given. */
  siteBackAt: string | null;
}

export interface ModelControls {
  rows: ModelControlRow[];
  settings: AiSettingsRow;
  /** The effective status of one pair: the model row, else its provider row. */
  statusOf(providerId: string, modelId: string): ModelStatus;
  priorityOf(providerId: string, modelId: string): number;
}

const DEFAULT_SETTINGS: AiSettingsRow = {
  maintenance: false,
  message: "Ugnay AI is temporarily unavailable for maintenance.",
  siteMaintenance: false,
  // No generic default: the maintenance screen shows only what an admin wrote.
  siteMessage: "",
  siteBackAt: null,
};

/**
 * Reads both tables. Any signed-in account may read them (routing needs them
 * on every request); only an admin may write, which RLS enforces.
 */
export async function loadModelControls(
  supabase: SupabaseClient,
): Promise<ModelControls> {
  const [controls, settings] = await Promise.all([
    supabase.from("model_controls").select("provider_id, model_id, status, priority, note, updated_at"),
    supabase
      .from("ai_settings")
      .select("maintenance, message, site_maintenance, site_message, site_back_at")
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (controls.error) console.error("[ugnay] Could not read the model controls:", controls.error);
  if (settings.error) console.error("[ugnay] Could not read the AI settings:", settings.error);

  const rows = (controls.data ?? []) as ModelControlRow[];
  const find = (providerId: string, modelId: string) =>
    rows.find((r) => r.provider_id === providerId && r.model_id === modelId);

  const stored = settings.data as
    | (Partial<AiSettingsRow> & {
        site_maintenance?: boolean;
        site_message?: string;
        site_back_at?: string | null;
      })
    | null;

  return {
    rows,
    settings: {
      maintenance: Boolean(stored?.maintenance),
      // Never let a blank row leave the caller without something to show.
      message: stored?.message?.trim() || DEFAULT_SETTINGS.message,
      siteMaintenance: Boolean(stored?.site_maintenance),
      siteMessage: stored?.site_message?.trim() ?? DEFAULT_SETTINGS.siteMessage,
      siteBackAt: stored?.site_back_at ?? null,
    },
    statusOf(providerId, modelId) {
      const provider = find(providerId, "");
      // A provider taken offline takes its models with it.
      if (provider && provider.status !== "available") return provider.status;
      return find(providerId, modelId)?.status ?? "available";
    },
    priorityOf(providerId, modelId) {
      return find(providerId, modelId)?.priority ?? find(providerId, "")?.priority ?? 0;
    },
  };
}
