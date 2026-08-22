import { NextResponse, type NextRequest } from "next/server";
import { ProviderError, resolveModel, type ProviderMessage } from "@/lib/providers";
import { composeSystemPrompt, withSystemPrompt } from "@/lib/prompt";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Several model calls in sequence need more room than a single reply. */
export const maxDuration = 120;

/** Workflow runs allowed per account per minute. */
const RATE_LIMIT = 6;
const RATE_WINDOW_MS = 60_000;

/** Steps one workflow may hold. Also enforced by the editor. */
const MAX_STEPS = 8;
/** Ceiling on the text a run starts from. */
const MAX_INPUT_CHARS = 24_000;
/** How much of a previous step's output is carried into the next one. */
const MAX_CARRY_CHARS = 12_000;

interface Step {
  title?: string;
  prompt?: string;
}

/**
 * Runs a saved workflow: each step is one model call, and every step after the
 * first receives the previous step's output as its material. Results stream back
 * as NDJSON, the same wire format `/api/chat` uses, so a long chain reports
 * progress instead of going quiet.
 *
 * Nothing is written to the database — a run is a transformation of the input
 * the caller supplied, not a conversation. The provider key stays server-side.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) console.error("[ugnay] /api/workflows/run could not read the session:", userError);
  if (!user) {
    return NextResponse.json(
      { error: "Your session has expired. Please sign in again.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const limit = rateLimit(`workflow:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) return tooManyRequests(limit.retryAfter);

  let body: { workflowId?: string; input?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const workflowId = body.workflowId?.trim();
  const input = body.input?.trim() ?? "";
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId is required." }, { status: 400 });
  }
  if (input.length > MAX_INPUT_CHARS) {
    return NextResponse.json(
      { error: `Keep the input under ${MAX_INPUT_CHARS} characters.` },
      { status: 400 },
    );
  }

  // RLS already scopes this; the explicit filter keeps the intent obvious.
  const { data: workflow, error: readError } = await supabase
    .from("workflows")
    .select("id, name, steps, provider, model")
    .eq("id", workflowId)
    .eq("user_id", user.id)
    .single();

  if (readError || !workflow) {
    console.error("[ugnay] /api/workflows/run could not load the workflow:", readError);
    return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
  }

  const steps = (Array.isArray(workflow.steps) ? workflow.steps : ([] as Step[]))
    .filter((step: Step) => typeof step?.prompt === "string" && step.prompt.trim())
    .slice(0, MAX_STEPS);

  if (steps.length === 0) {
    return NextResponse.json(
      { error: "This workflow has no steps yet. Add one and try again." },
      { status: 400 },
    );
  }

  const { data: settings } = await supabase
    .from("user_settings")
    .select("global_system_prompt, temperature, max_tokens, default_provider, default_model")
    .eq("user_id", user.id)
    .maybeSingle();

  let provider: ReturnType<typeof resolveModel>["provider"];
  let model: string;
  try {
    ({ provider, model } = resolveModel(
      workflow.provider ?? settings?.default_provider ?? "openrouter",
      workflow.model ?? settings?.default_model ?? "openrouter/free",
    ));
  } catch (err) {
    console.error("[ugnay] /api/workflows/run could not resolve the model:", err);
    const message = err instanceof ProviderError ? err.message : "That model is not available.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      /** The previous step's output, which the next step works from. */
      let carried = input;

      try {
        send({ type: "start", provider: provider.id, model, steps: steps.length });

        for (const [index, step] of steps.entries()) {
          const title = typeof step.title === "string" && step.title.trim()
            ? step.title.trim()
            : `Step ${index + 1}`;
          send({ type: "step", index, title });

          const material = carried.slice(0, MAX_CARRY_CHARS);
          const userContent =
            index === 0
              ? material
                ? `${step.prompt!.trim()}\n\nHere is the material to work from:\n\n${material}`
                : step.prompt!.trim()
              : [
                  step.prompt!.trim(),
                  "",
                  "Here is the output of the previous step. Work from it:",
                  "",
                  material,
                ].join("\n");

          const conversation: ProviderMessage[] = withSystemPrompt(
            [{ role: "user", content: userContent }],
            composeSystemPrompt(
              settings?.global_system_prompt ?? null,
              `You are running step ${index + 1} of ${steps.length} in a saved workflow called "${workflow.name}". Produce only this step's output — no preamble, and no commentary about the workflow itself.`,
              null,
            ),
          );

          let text = "";
          for await (const event of provider.streamChat({
            model,
            messages: conversation,
            temperature: settings?.temperature ?? 0.7,
            maxTokens: settings?.max_tokens ?? 2048,
            signal: abort.signal,
          })) {
            if (event.type === "delta") {
              text += event.text;
              send({ type: "delta", index, text: event.text });
            }
          }

          if (!text.trim()) {
            send({
              type: "error",
              error: `${title} returned an empty response. Try again or pick another model.`,
            });
            return;
          }

          send({ type: "step-done", index, content: text });
          carried = text;
        }

        send({ type: "done", output: carried });
      } catch (err) {
        const message =
          err instanceof ProviderError
            ? err.message
            : "Something went wrong while running this workflow.";
        console.error("[ugnay] /api/workflows/run failed:", err);
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
