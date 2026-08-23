import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { loadModelControls, type ModelStatus } from "@/lib/model-controls";
import { getModelHealth, isModelAvailable, listCatalog } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set<ModelStatus>(["available", "disabled", "maintenance"]);

/** 404-shaped denial: a normal user learns nothing about this surface. */
function denied() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

/**
 * The admin AI Models view: every configured provider and model, with the
 * admin override on top and the live health record from the routing layer.
 */
export async function GET() {
  if (!(await isCurrentUserAdmin())) return denied();
  const supabase = await createClient();
  const controls = await loadModelControls(supabase);

  const providers = listCatalog().map((entry) => ({
    id: entry.id,
    label: entry.label,
    configured: entry.configured,
    status: controls.statusOf(entry.id, ""),
    models: entry.models.map((model) => {
      const health = getModelHealth(entry.id, model.id);
      const status = controls.statusOf(entry.id, model.id);
      return {
        id: model.id,
        label: model.label,
        description: model.description ?? null,
        free: model.free,
        status,
        priority: controls.priorityOf(entry.id, model.id),
        // "Unavailable" is the live state; the statuses above are the admin's.
        available: entry.configured && isModelAvailable(entry.id, model.id),
        latencyMs: health.latencyMs ?? null,
        failures: health.failures,
        lastErrorAt: health.lastErrorAt ?? null,
        lastErrorStatus: health.lastErrorStatus ?? null,
        lastOkAt: health.lastOkAt ?? null,
      };
    }),
  }));

  return NextResponse.json({ providers, settings: controls.settings });
}

/** Sets the status/priority of one model, or of a whole provider (no modelId). */
export async function PATCH(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: { providerId?: string; modelId?: string; status?: string; priority?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  const modelId = typeof body.modelId === "string" ? body.modelId : "";
  if (!providerId || !listCatalog().some((p) => p.id === providerId)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 400 });
  }
  if (body.status !== undefined && !STATUSES.has(body.status as ModelStatus)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("model_controls").upsert(
    {
      provider_id: providerId,
      model_id: modelId,
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(typeof body.priority === "number" ? { priority: Math.trunc(body.priority) } : {}),
      updated_by: user?.id ?? null,
    },
    { onConflict: "provider_id,model_id" },
  );

  if (error) {
    console.error("[ugnay] Could not save the model control:", error);
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** The global switch that takes Ugnay AI chat offline. */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: {
    maintenance?: boolean;
    message?: string;
    siteMaintenance?: boolean;
    siteMessage?: string;
    siteBackAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.maintenance !== "boolean" && typeof body.siteMaintenance !== "boolean") {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const siteMessage = typeof body.siteMessage === "string" ? body.siteMessage.trim() : "";
  const { error } = await supabase
    .from("ai_settings")
    .update({
      ...(typeof body.maintenance === "boolean" ? { maintenance: body.maintenance } : {}),
      ...(message ? { message } : {}),
      ...(typeof body.siteMaintenance === "boolean"
        ? { site_maintenance: body.siteMaintenance }
        : {}),
      ...(siteMessage ? { site_message: siteMessage } : {}),
      ...(body.siteBackAt !== undefined
        ? { site_back_at: body.siteBackAt ? new Date(body.siteBackAt).toISOString() : null }
        : {}),
      updated_by: user?.id ?? null,
    })
    .eq("id", true);

  if (error) {
    console.error("[ugnay] Could not save the AI settings:", error);
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
