"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clock, Coins, Loader2, Lock, QrCode, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Pack {
  key: string;
  title: string;
  credits: number;
  price_cents: number;
  currency: string;
}

interface Method {
  id: "paypal" | "gcash";
  label: string;
  /** False when the method cannot be paid to; it is shown greyed out. */
  configured: boolean;
  verification: "manual" | "unavailable";
  unavailableReason: string | null;
  destination: string;
  accountName: string;
  qrImageUrl: string | null;
  instructions: string[];
}

interface Order {
  id: string;
  package_key: string;
  credits: number;
  price_cents: number;
  currency: string;
  provider: string;
  status: "pending" | "submitted" | "approved" | "rejected" | "cancelled";
  reference: string | null;
  admin_note: string | null;
  payer_note: string | null;
  paid_cents: number | null;
  created_at: string;
  reviewed_at: string | null;
}

const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const fieldClass =
  "w-full rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function price(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** What each status means to the person who paid. */
const STATUS: Record<Order["status"], { label: string; tone: string; note: string }> = {
  pending: {
    label: "Awaiting payment",
    tone: "text-neutral-400",
    note: "Pay using the instructions, then submit your reference number and receipt.",
  },
  submitted: {
    label: "Pending",
    tone: "text-amber-400",
    note: "Waiting for admin verification. Credits are added once your payment is confirmed.",
  },
  approved: {
    label: "Approved",
    tone: "text-emerald-400",
    note: "The credits are in your wallet.",
  },
  rejected: {
    label: "Rejected",
    tone: "text-danger",
    note: "The payment could not be confirmed, so no credits were added.",
  },
  cancelled: { label: "Cancelled", tone: "text-neutral-500", note: "" },
};

/**
 * The credits store: pick a package, pick a payment method, pay, then submit
 * your reference and receipt for review.
 *
 * Nothing here grants credits, and nothing here decides that a payment has been
 * made. The reference number, the amount, the note and the screenshot are all
 * claims — they are shown to an admin, who approves or rejects. Only approval
 * grants credits, and that happens server-side through the existing ledger.
 *
 * An unconfigured payment method is shown greyed out rather than hidden, so it
 * is clear that it exists and is simply not available yet.
 */
export default function CreditsStore() {
  const [packages, setPackages] = useState<Pack[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /** The package and method chosen, before an order exists. */
  const [pick, setPick] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<string | null>(null);

  /** The order in progress, once it has been started. */
  const [chosen, setChosen] = useState<Pack | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [payerNote, setPayerNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/credits/orders", { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load the store.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPackages(data.packages ?? []);
    setMethods(data.methods ?? []);
    setOrders(data.orders ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = packages.find((p) => p.key === pick) ?? null;
  const selectedMethod = methods.find((m) => m.id === payWith) ?? null;
  const usable = methods.filter((m) => m.configured);

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/credits/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, body: await res.json().catch(() => null) };
  }

  /** Starts the order, which is what unlocks the payment instructions. */
  async function startOrder() {
    if (!selected || !selectedMethod?.configured) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const { ok, body } = await post({
      action: "create",
      packageKey: selected.key,
      provider: selectedMethod.id,
    });
    if (!ok || !body?.ok) setError(body?.error ?? body?.reason ?? "Could not start that order.");
    else {
      setChosen(selected);
      setMethod(selectedMethod);
      setOrderId(body.orderId as string);
      // The amount to send is the package price; pre-filled so the payer
      // confirms it rather than inventing a figure.
      setAmount((selected.price_cents / 100).toFixed(2));
    }
    await load();
    setBusy(false);
  }

  function resetForm() {
    setChosen(null);
    setMethod(null);
    setOrderId(null);
    setReference("");
    setAmount("");
    setPayerNote("");
    setProof(null);
  }

  async function submitOrder() {
    if (!orderId || !reference.trim() || !proof) return;
    setBusy(true);
    setError(null);

    // The receipt goes to a private bucket under the payer's own id; only the
    // path travels with the order, and an admin reads it through a signed URL.
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Please sign in again.");
      setBusy(false);
      return;
    }

    const path = `${user.id}/${orderId}-${Date.now()}-${proof.name.slice(-40)}`;
    const { error: uploadError } = await supabase.storage
      .from("receipts")
      .upload(path, proof, { upsert: false });

    if (uploadError) {
      console.error("[ugnay] Could not upload the receipt:", uploadError);
      setError("Could not upload your proof of payment. Please try again.");
      setBusy(false);
      return;
    }

    const cents = Math.round(Number(amount) * 100);
    const { ok, body } = await post({
      action: "submit",
      orderId,
      reference: reference.trim(),
      proofPath: path,
      paidCents: Number.isFinite(cents) && cents >= 0 ? cents : null,
      payerNote: payerNote.trim(),
    });
    if (!ok || !body?.ok) setError(body?.error ?? body?.reason ?? "Could not submit that order.");
    else {
      setNote("Submitted. Waiting for admin verification.");
      resetForm();
      setPick(null);
      setPayWith(null);
    }
    await load();
    setBusy(false);
  }

  async function cancelOrder(id: string) {
    setBusy(true);
    const { ok, body } = await post({ action: "cancel", orderId: id });
    if (!ok || !body?.ok) setError(body?.error ?? body?.reason ?? "Could not cancel that order.");
    if (id === orderId) resetForm();
    await load();
    setBusy(false);
  }

  return (
    <main className="min-h-dvh bg-ink-950">
      <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-safe sm:px-8">
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 text-xs text-neutral-400 transition hover:text-neutral-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to Ugnay
        </Link>

        <div className="mt-6 flex items-start gap-3">
          <Coins className="mt-1 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-neutral-100">
              Buy credits
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-neutral-400">
              Top up your wallet. Payments are checked by hand, so credits arrive once an admin
              confirms yours. You can still earn credits for free from the daily claim and tasks.
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs text-danger"
          >
            {error}
          </p>
        )}
        {note && <p className="mt-6 text-xs text-emerald-400">{note}</p>}

        {loading ? (
          <div className="mt-8 space-y-3" aria-busy="true">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-ink-900" />
            ))}
          </div>
        ) : (
          <>
            {/* Step 1 — the package. Chosen explicitly, so the credits being
              * bought are shown before anything is paid. */}
            <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-neutral-500">
              1 · Choose a package
            </h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {packages.map((pack) => {
                const active = pick === pack.key;
                return (
                  <button
                    key={pack.key}
                    type="button"
                    aria-pressed={active}
                    disabled={busy || orderId !== null}
                    onClick={() => setPick(pack.key)}
                    className={cn(
                      cardClass,
                      "text-left transition disabled:opacity-60",
                      active ? "border-accent/50 bg-ink-850" : "hover:border-ink-700",
                    )}
                  >
                    <p className="font-display text-2xl font-semibold text-neutral-100">
                      {nf.format(pack.credits)}
                      <span className="ml-1.5 text-sm font-normal text-neutral-500">credits</span>
                    </p>
                    <p className="mt-1 text-sm text-neutral-300">
                      {price(pack.price_cents, pack.currency)}
                    </p>
                    {active && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent">
                        <Check className="h-3 w-3" aria-hidden />
                        Selected
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Step 2 — the method. Unconfigured ones stay visible but grey. */}
            <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-neutral-500">
              2 · Choose how to pay
            </h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {methods.map((pay) => {
                const active = payWith === pay.id;
                return (
                  <button
                    key={pay.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!pay.configured || busy || orderId !== null}
                    title={pay.unavailableReason ?? undefined}
                    onClick={() => setPayWith(pay.id)}
                    className={cn(
                      cardClass,
                      "flex items-center justify-between gap-3 text-left transition",
                      !pay.configured
                        ? "cursor-not-allowed opacity-50"
                        : active
                          ? "border-accent/50 bg-ink-850"
                          : "hover:border-ink-700",
                      pay.configured && (busy || orderId !== null) && "opacity-60",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-neutral-100">
                        {pay.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        {pay.configured
                          ? "Checked by an admin before credits arrive"
                          : (pay.unavailableReason ?? "Unavailable")}
                      </span>
                    </span>
                    {!pay.configured ? (
                      <Lock className="h-4 w-4 shrink-0 text-neutral-600" aria-hidden />
                    ) : active ? (
                      <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>

            {!usable.length && (
              <p className={cn(cardClass, "mt-3 text-xs leading-relaxed text-neutral-500")}>
                No payment method is configured yet, so credits cannot be bought here. You can
                still earn them from the daily claim and tasks in your wallet.
              </p>
            )}

            {/* What is being bought, confirmed before any money moves. */}
            {selected && selectedMethod?.configured && !orderId && (
              <div className={cn(cardClass, "mt-4 border-accent/30")}>
                <p className="text-sm text-neutral-300">
                  You will receive{" "}
                  <span className="font-medium text-neutral-100">
                    {nf.format(selected.credits)} credits
                  </span>{" "}
                  for{" "}
                  <span className="font-medium text-neutral-100">
                    {price(selected.price_cents, selected.currency)}
                  </span>{" "}
                  via {selectedMethod.label}.
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                  Credits are added only after an admin confirms your payment.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startOrder()}
                  className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Continue to payment
                </button>
              </div>
            )}

            {/* Step 3 — pay, then submit the proof. */}
            {chosen && method && orderId && (
              <section className={cn(cardClass, "mt-4 border-accent/30")}>
                <h2 className="text-sm font-medium text-neutral-100">
                  3 · Send {price(chosen.price_cents, chosen.currency)} with {method.label}
                </h2>
                <p className="mt-1 text-[11px] text-neutral-500">
                  For {nf.format(chosen.credits)} credits. Send the exact amount.
                </p>

                <div className="mt-3 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                    {method.label} account
                  </p>
                  <p className="mt-0.5 break-words text-sm text-neutral-100">
                    {method.destination}
                  </p>
                  {method.accountName && (
                    <p className="text-xs text-neutral-400">{method.accountName}</p>
                  )}
                </div>

                {/* A plain img: the QR is a signed URL for whatever the admin
                  * uploaded, so it is not a host next/image can be told about.
                  * With no QR configured the space says so plainly rather than
                  * showing a placeholder image that could not be scanned. */}
                {method.qrImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={method.qrImageUrl}
                    alt={`${method.label} QR code`}
                    width={180}
                    height={180}
                    className="mt-3 rounded-xl border border-ink-800 bg-ink-950 p-2"
                  />
                ) : (
                  <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-dashed border-ink-700 bg-ink-950 px-3.5 py-3">
                    <QrCode className="h-4 w-4 shrink-0 text-neutral-600" aria-hidden />
                    <p className="text-[11px] leading-relaxed text-neutral-500">
                      QR code coming soon. Send to the {method.label} number above instead.
                    </p>
                  </div>
                )}

                {method.instructions.length > 0 && (
                  <ol className="mt-3 space-y-1.5 text-xs leading-relaxed text-neutral-400">
                    {method.instructions.map((line, i) => (
                      <li key={line} className="flex gap-2">
                        <span className="text-neutral-600">{i + 1}.</span>
                        {line}
                      </li>
                    ))}
                  </ol>
                )}

                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="amount" className="mb-1.5 block text-xs text-neutral-400">
                      Amount you sent ({chosen.currency})
                    </label>
                    <input
                      id="amount"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={(chosen.price_cents / 100).toFixed(2)}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="reference" className="mb-1.5 block text-xs text-neutral-400">
                      {method.label} reference number
                    </label>
                    <input
                      id="reference"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. 0123 456 789012"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="proof" className="mb-1.5 block text-xs text-neutral-400">
                      Proof of payment (screenshot)
                    </label>
                    <input
                      id="proof"
                      type="file"
                      accept="image/*"
                      onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                      className="w-full text-xs text-neutral-400 file:mr-3 file:rounded-lg file:border file:border-ink-700 file:bg-ink-850 file:px-3 file:py-1.5 file:text-xs file:text-neutral-200"
                    />
                    <p className="mt-1 text-[11px] text-neutral-600">
                      Required. Only the reviewing admin can open it.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="payerNote" className="mb-1.5 block text-xs text-neutral-400">
                      Note (optional)
                    </label>
                    <textarea
                      id="payerNote"
                      rows={2}
                      value={payerNote}
                      onChange={(e) => setPayerNote(e.target.value)}
                      placeholder="Anything the reviewer should know"
                      className={cn(fieldClass, "resize-none")}
                    />
                  </div>
                </div>

                <p className="mt-3 rounded-xl border border-ink-800 bg-ink-950 px-3.5 py-2.5 text-[11px] leading-relaxed text-neutral-500">
                  Submitting does not add credits. Your payment is verified by an admin first;
                  once approved, exactly {nf.format(chosen.credits)} credits are added to your
                  wallet.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !reference.trim() || !proof}
                    onClick={() => void submitOrder()}
                    className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    I have paid — submit for review
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelOrder(orderId)}
                    className="rounded-lg border border-ink-700 px-3.5 py-2 text-xs text-neutral-300 transition hover:bg-ink-850 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </section>
            )}

            {/* History */}
            <h2 className="mt-8 text-xs font-medium uppercase tracking-wider text-neutral-500">
              Your orders
            </h2>
            {orders.length ? (
              <ul className="mt-2 space-y-2">
                {orders.map((order) => {
                  const state = STATUS[order.status];
                  return (
                    <li key={order.id} className={cn(cardClass, "py-3")}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 text-sm text-neutral-100">
                          {nf.format(order.credits)} credits
                          <span className="ml-2 text-[11px] text-neutral-500">
                            {price(order.price_cents, order.currency)} · {order.provider}
                          </span>
                        </span>
                        <span className={cn("flex items-center gap-1.5 text-xs", state.tone)}>
                          {order.status === "approved" ? (
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          ) : order.status === "rejected" || order.status === "cancelled" ? (
                            <X className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {state.label}
                        </span>
                      </div>
                      {state.note && (
                        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                          {state.note}
                        </p>
                      )}
                      {order.admin_note && (
                        <p
                          className={cn(
                            "mt-1 text-[11px] leading-relaxed",
                            order.status === "rejected" ? "text-danger" : "text-neutral-400",
                          )}
                        >
                          {order.status === "rejected" ? "Reason: " : "Note from Ugnay: "}
                          {order.admin_note}
                        </p>
                      )}
                      {(order.status === "pending" || order.status === "submitted") && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void cancelOrder(order.id)}
                          className="mt-2 text-[11px] text-neutral-500 transition hover:text-neutral-300 disabled:opacity-60"
                        >
                          Cancel this order
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-neutral-600">
                No orders yet. Pick a package above to buy credits.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
