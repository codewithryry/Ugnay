import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404-shaped denial, like the other admin routes. */
function denied() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

/** The payment queue: submitted first, then everything else. */
export async function GET() {
  if (!(await isCurrentUserAdmin())) return denied();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_credit_orders", { limit_count: 50 });
  if (error) {
    console.error("[ugnay] Could not read the credit orders:", error);
    return NextResponse.json({ error: "Could not load the payments." }, { status: 500 });
  }

  const orders = (data ?? []) as Array<Record<string, unknown>>;

  // A receipt is a private object; hand the reviewer a short-lived link rather
  // than making the bucket readable.
  const withProof = await Promise.all(
    orders.map(async (order) => {
      const path = order.proof_path as string | null;
      if (!path) return { ...order, proofUrl: null };
      const { data: signed } = await supabase.storage
        .from("receipts")
        .createSignedUrl(path, 300);
      return { ...order, proofUrl: signed?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({ orders: withProof });
}

/**
 * Approve or reject one payment. The decision, the idempotency and the grant
 * all happen inside review_credit_order(), which is admin-only in the database
 * as well as here — and which pays through the existing credit ledger exactly
 * once, latched on the order's granted_at.
 */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: { orderId?: string; decision?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.orderId || (body.decision !== "approved" && body.decision !== "rejected")) {
    return NextResponse.json({ error: "Approve or reject which order?" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_credit_order", {
    order_id: body.orderId,
    decision: body.decision,
    note: typeof body.note === "string" ? body.note.slice(0, 400) : null,
  });

  if (error) {
    console.error("[ugnay] Could not review the order:", error);
    return NextResponse.json({ error: "Could not record that decision." }, { status: 500 });
  }
  return NextResponse.json(data ?? { ok: false });
}
