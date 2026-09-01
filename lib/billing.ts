/**
 * How Ugnay takes payment for credits.
 *
 * Every method here is *manually verified*: the app shows the configured
 * destination, the payer says they have paid and attaches proof, and an admin
 * decides. Nothing in this file marks anything as paid, and no credit is ever
 * granted from it — approval happens in review_credit_order(), which is
 * admin-only and pays through the same award path as every other credit.
 *
 * A method is configured when it has a destination. An unconfigured one is
 * still returned, so the store can show it greyed out and clearly unavailable
 * rather than pretending it does not exist.
 *
 * The shape is deliberately provider-shaped so a real PayPal integration can
 * be added later as `verification: "automatic"` with a webhook route, without
 * changing the order table, the granting path, or the UI's understanding of
 * an order.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentProvider = "paypal" | "gcash";

export interface PaymentMethod {
  id: PaymentProvider;
  label: string;
  /** False when there is no destination to pay to, which greys it out. */
  configured: boolean;
  /**
   * "manual" means an admin checks each payment by hand. "unavailable" means
   * there is no way to take payment at all yet — PayPal, until a real
   * integration exists. Nothing is ever verified automatically here.
   */
  verification: "manual" | "unavailable";
  /** Where to send the money. Public by nature — it is how someone pays. */
  destination: string;
  /** The account name shown beside the number, when there is one. */
  accountName: string;
  /** A signed URL for the QR image, when one is configured. */
  qrImageUrl?: string;
  instructions: string[];
  /** Why this method cannot be used, when it cannot. */
  unavailableReason?: string;
}

/** A row as stored. `qr_path` is resolved to a URL before it reaches a client. */
interface MethodRow {
  id: string;
  label: string;
  verification: string;
  destination: string;
  account_name: string;
  qr_path: string;
  instructions: string;
  enabled: boolean;
  sort_order: number;
}

/**
 * Environment fallbacks, used only for a method that has no destination in the
 * database. A deployment that already configured GCash through env keeps
 * working; anything set in Admin takes precedence.
 */
function fromEnv(id: string): { destination: string; accountName: string; qr: string } {
  if (id === "gcash") {
    return {
      destination: process.env.GCASH_NUMBER?.trim() ?? "",
      accountName: process.env.GCASH_NAME?.trim() ?? "",
      qr: process.env.GCASH_QR_URL?.trim() ?? "",
    };
  }
  if (id === "paypal") {
    return {
      destination: process.env.PAYPAL_PAYMENT_LINK?.trim() ?? "",
      accountName: "",
      qr: "",
    };
  }
  return { destination: "", accountName: "", qr: "" };
}

/** Splits the stored instruction block into the lines the UI numbers. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Reads the configured methods. Takes a Supabase client so it can resolve a
 * QR stored in the private 'receipts' bucket into a short-lived signed URL —
 * the bucket itself is never opened up.
 */
export async function paymentMethods(
  supabase: SupabaseClient,
): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("id, label, verification, destination, account_name, qr_path, instructions, enabled, sort_order")
    .order("sort_order");

  if (error) {
    console.error("[ugnay] Could not read the payment methods:", error);
    return [];
  }

  return Promise.all(
    ((data ?? []) as MethodRow[]).map(async (row) => {
      const env = fromEnv(row.id);
      const destination = row.destination.trim() || env.destination;
      const accountName = row.account_name.trim() || env.accountName;
      const qr = row.qr_path.trim() || env.qr;

      // An absolute URL is used as-is; a storage path is signed for a while.
      let qrImageUrl: string | undefined;
      if (qr.startsWith("http://") || qr.startsWith("https://")) {
        qrImageUrl = qr;
      } else if (qr) {
        const { data: signed } = await supabase.storage
          .from("receipts")
          .createSignedUrl(qr, 3600);
        qrImageUrl = signed?.signedUrl ?? undefined;
      }

      const verification = row.verification === "unavailable" ? "unavailable" : "manual";
      // Both conditions have to hold: a method needs somewhere to send money,
      // and a way for someone to confirm it arrived.
      const configured =
        verification === "manual" && row.enabled && Boolean(destination);

      return {
        id: row.id as PaymentProvider,
        label: row.label,
        configured,
        verification,
        destination,
        accountName,
        qrImageUrl,
        instructions: lines(row.instructions),
        unavailableReason:
          verification === "unavailable"
            ? "Not available yet"
            : !row.enabled
              ? "Temporarily switched off"
              : !destination
                ? "Not configured yet"
                : undefined,
      } satisfies PaymentMethod;
    }),
  );
}

/** One method, and only if it can actually be paid to. */
export async function paymentMethod(supabase: SupabaseClient, id: string) {
  const all = await paymentMethods(supabase);
  return all.find((m) => m.id === id && m.configured) ?? null;
}

/** Minor units to something a person reads: 19900 -> "₱199.00". */
export function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    // An unknown currency code should not break a price.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
