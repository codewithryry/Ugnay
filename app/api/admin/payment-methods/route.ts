import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin";
import { paymentMethods } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404-shaped denial, like the other admin routes. */
function denied() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

/**
 * Every payment method as an admin sees it: the destination, the account name,
 * the QR and whether the method is usable at all. Nothing here is a secret —
 * a payment destination is public by nature, since it is how someone pays —
 * but it is still admin-only, because only an admin may change it.
 */
export async function GET() {
  if (!(await isCurrentUserAdmin())) return denied();
  const supabase = await createClient();

  const [resolved, rows] = await Promise.all([
    paymentMethods(supabase),
    supabase
      .from("payment_methods")
      .select("id, label, verification, destination, account_name, qr_path, instructions, enabled, sort_order")
      .order("sort_order"),
  ]);

  if (rows.error) {
    console.error("[ugnay] Could not read the payment methods:", rows.error);
    return NextResponse.json({ error: "Could not load the payment methods." }, { status: 500 });
  }

  // The stored row is what the form edits; the resolved method carries the
  // signed QR URL and the effective configured/unavailable state.
  return NextResponse.json({
    methods: (rows.data ?? []).map((row) => {
      const effective = resolved.find((m) => m.id === row.id);
      return {
        ...row,
        configured: effective?.configured ?? false,
        qrImageUrl: effective?.qrImageUrl ?? null,
        unavailableReason: effective?.unavailableReason ?? null,
      };
    }),
  });
}

/**
 * Saves one method's configuration. `verification` is deliberately not
 * editable: a method is manual or it is unavailable, and turning PayPal into a
 * manual method by hand would let an admin approve payments there is no way to
 * confirm. Changing that is a code change, made when a real integration lands.
 */
export async function PATCH(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  let body: {
    id?: string;
    destination?: string;
    accountName?: string;
    qrPath?: string;
    instructions?: string;
    enabled?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "Which payment method?" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("payment_methods")
    .update({
      ...(typeof body.destination === "string"
        ? { destination: body.destination.trim().slice(0, 200) }
        : {}),
      ...(typeof body.accountName === "string"
        ? { account_name: body.accountName.trim().slice(0, 120) }
        : {}),
      ...(typeof body.qrPath === "string" ? { qr_path: body.qrPath.trim().slice(0, 500) } : {}),
      ...(typeof body.instructions === "string"
        ? { instructions: body.instructions.slice(0, 2000) }
        : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      updated_by: user?.id ?? null,
    })
    .eq("id", body.id);

  if (error) {
    console.error("[ugnay] Could not save the payment method:", error);
    return NextResponse.json({ error: "Could not save the change." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Uploads a QR image and stores its path on the method. It goes to the private
 * 'receipts' bucket under 'public/', which only an admin may write; payers are
 * handed a short-lived signed URL rather than the bucket being opened up.
 */
export async function POST(request: NextRequest) {
  if (!(await isCurrentUserAdmin())) return denied();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const id = form?.get("id");

  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Which payment method?" }, { status: 400 });
  }
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "The QR code has to be an image." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "That image is larger than 5 MB." }, { status: 400 });
  }

  const supabase = await createClient();
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 8) : "png";
  const path = `public/${id}-qr-${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[ugnay] Could not upload the QR image:", uploadError);
    return NextResponse.json({ error: "Could not upload that image." }, { status: 500 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("payment_methods")
    .update({ qr_path: path, updated_by: user?.id ?? null })
    .eq("id", id);

  if (error) {
    console.error("[ugnay] Could not save the QR path:", error);
    return NextResponse.json({ error: "Could not save that image." }, { status: 500 });
  }

  const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
  return NextResponse.json({ ok: true, qrPath: path, qrImageUrl: signed?.signedUrl ?? null });
}
