import { NextResponse, type NextRequest } from "next/server";
import { paymentMethod, paymentMethods } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The store: packages, how to pay, and this account's own order history. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const [packagesRes, ordersRes, methods] = await Promise.all([
    supabase
      .from("credit_packages")
      .select("key, title, credits, price_cents, currency")
      .eq("enabled", true)
      .order("sort_order"),
    supabase
      .from("credit_orders")
      .select(
        "id, package_key, credits, price_cents, currency, provider, status, reference, admin_note, payer_note, paid_cents, created_at, reviewed_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    paymentMethods(supabase),
  ]);

  if (packagesRes.error) {
    console.error("[ugnay] Could not read the credit packages:", packagesRes.error);
    return NextResponse.json({ error: "Could not load the store." }, { status: 500 });
  }

  return NextResponse.json({
    packages: (packagesRes.data ?? []).map((p) => ({ ...p, credits: Number(p.credits) })),
    // Every method, including the ones that cannot be used: the store shows
    // those greyed out rather than hiding them. Only what a payer needs in
    // order to pay is sent, and a method that is not configured carries no
    // destination at all.
    methods: methods.map((m) => ({
      id: m.id,
      label: m.label,
      configured: m.configured,
      verification: m.verification,
      unavailableReason: m.unavailableReason ?? null,
      destination: m.configured ? m.destination : "",
      accountName: m.configured ? m.accountName : "",
      qrImageUrl: m.configured ? (m.qrImageUrl ?? null) : null,
      instructions: m.configured ? m.instructions : [],
    })),
    orders: (ordersRes.data ?? []).map((o) => ({ ...o, credits: Number(o.credits) })),
  });
}

/**
 * Starts an order, or submits/cancels one the caller already owns. Every
 * branch is a security-definer function that re-checks ownership; the amounts
 * always come from the package row, never from this request.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: {
    action?: "create" | "submit" | "cancel";
    packageKey?: string;
    provider?: string;
    orderId?: string;
    reference?: string;
    proofPath?: string;
    /** What the payer says they sent, in minor units. A claim, never checked. */
    paidCents?: number;
    payerNote?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.action === "create") {
    if (!body.packageKey || !body.provider) {
      return NextResponse.json({ error: "Pick a package and a payment method." }, { status: 400 });
    }
    // A method with nothing configured cannot be paid to, so it cannot be ordered.
    if (!(await paymentMethod(supabase, body.provider))) {
      return NextResponse.json({ error: "That payment method is unavailable." }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("create_credit_order", {
      package: body.packageKey,
      pay_provider: body.provider,
    });
    if (error) {
      console.error("[ugnay] Could not create the order:", error);
      return NextResponse.json({ error: "Could not start that order." }, { status: 500 });
    }
    return NextResponse.json(data ?? { ok: false });
  }

  if (body.action === "submit") {
    if (!body.orderId || !body.reference?.trim()) {
      return NextResponse.json({ error: "Enter your payment reference." }, { status: 400 });
    }
    // A manual review needs something to look at. The database refuses a
    // submission without proof too; this is the readable version.
    if (!body.proofPath?.trim()) {
      return NextResponse.json({ error: "Attach your proof of payment." }, { status: 400 });
    }
    const paid = Number(body.paidCents);
    const { data, error } = await supabase.rpc("submit_credit_order", {
      order_id: body.orderId,
      reference_text: body.reference.slice(0, 120),
      proof: body.proofPath,
      paid_amount: Number.isFinite(paid) && paid >= 0 ? Math.trunc(paid) : null,
      note_text: typeof body.payerNote === "string" ? body.payerNote.slice(0, 500) : null,
    });
    if (error) {
      console.error("[ugnay] Could not submit the order:", error);
      return NextResponse.json({ error: "Could not submit that order." }, { status: 500 });
    }
    return NextResponse.json(data ?? { ok: false });
  }

  if (body.action === "cancel") {
    if (!body.orderId) return NextResponse.json({ error: "Which order?" }, { status: 400 });
    const { data, error } = await supabase.rpc("cancel_credit_order", { order_id: body.orderId });
    if (error) {
      console.error("[ugnay] Could not cancel the order:", error);
      return NextResponse.json({ error: "Could not cancel that order." }, { status: 500 });
    }
    return NextResponse.json(data ?? { ok: false });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
