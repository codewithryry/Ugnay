"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface Order {
  id: string;
  account: string | null;
  package_key: string;
  credits: number;
  price_cents: number;
  currency: string;
  provider: string;
  status: "pending" | "submitted" | "approved" | "rejected" | "cancelled";
  reference: string | null;
  proofUrl: string | null;
  admin_note: string | null;
  /** What the payer says they sent, and whatever they wanted to add. Claims. */
  paid_cents: number | null;
  payer_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/** One configurable payment method, as the admin form edits it. */
interface Method {
  id: string;
  label: string;
  verification: "manual" | "unavailable";
  destination: string;
  account_name: string;
  qr_path: string;
  instructions: string;
  enabled: boolean;
  configured: boolean;
  qrImageUrl: string | null;
  unavailableReason: string | null;
}

const cardClass = "rounded-2xl border border-ink-800 bg-ink-900 p-4";
const fieldClass =
  "w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600";
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const TONE: Record<Order["status"], string> = {
  pending: "text-neutral-400",
  submitted: "text-amber-400",
  approved: "text-emerald-400",
  rejected: "text-danger",
  cancelled: "text-neutral-500",
};

function price(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Admin → Payments: the manual verification queue.
 *
 * Nothing on this screen decides anything by itself. Approving calls
 * review_credit_order(), which is admin-only in the database, grants through
 * the existing ledger, and latches on the order so a second approval — or two
 * admins at once — cannot pay twice.
 */
export default function AdminPaymentsSection() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [methods, setMethods] = useState<Method[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Method>>>({});
  const [savingMethod, setSavingMethod] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [ordersRes, methodsRes] = await Promise.all([
      apiFetch("/api/admin/orders", { cache: "no-store" }),
      apiFetch("/api/admin/payment-methods", { cache: "no-store" }),
    ]);
    if (!ordersRes.ok) {
      setError("Could not load the payments.");
      setLoading(false);
      return;
    }
    const data = await ordersRes.json();
    setOrders(
      (data.orders ?? []).map((o: Order) => ({ ...o, credits: Number(o.credits) })),
    );
    if (methodsRes.ok) {
      const config = await methodsRes.json();
      setMethods(config.methods ?? []);
      setDrafts({});
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    setError(null);
    setNote(null);
    const res = await apiFetch("/api/admin/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: id, decision, note: notes[id] ?? "" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) setError(body?.error ?? body?.reason ?? "Could not save that.");
    else if (decision === "approved") setNote(`${nf.format(Number(body.credits))} credits added.`);
    else setNote("Payment rejected.");
    await load();
    setBusy(null);
  }

  /** The edited value for a field, falling back to what is stored. */
  function value<K extends keyof Method>(method: Method, key: K): Method[K] {
    const draft = drafts[method.id]?.[key];
    return (draft === undefined ? method[key] : draft) as Method[K];
  }

  function edit(id: string, patch: Partial<Method>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  /** Saves one method. Nothing here can make an unavailable method payable. */
  async function saveMethod(method: Method) {
    setSavingMethod(method.id);
    setError(null);
    setNote(null);
    const draft = drafts[method.id] ?? {};
    const res = await apiFetch("/api/admin/payment-methods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: method.id,
        destination: draft.destination ?? method.destination,
        accountName: draft.account_name ?? method.account_name,
        instructions: draft.instructions ?? method.instructions,
        enabled: draft.enabled ?? method.enabled,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) setError(body?.error ?? "Could not save that.");
    else setNote(`${method.label} saved.`);
    await load();
    setSavingMethod(null);
  }

  /** Uploads a QR image straight to the admin route, which stores its path. */
  async function uploadQr(method: Method, file: File) {
    setSavingMethod(method.id);
    setError(null);
    setNote(null);
    const form = new FormData();
    form.append("id", method.id);
    form.append("file", file);
    const res = await apiFetch("/api/admin/payment-methods", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) setError(body?.error ?? "Could not upload that image.");
    else setNote(`${method.label} QR code updated.`);
    await load();
    setSavingMethod(null);
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl bg-ink-900" aria-busy="true" />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-xs text-danger"
        >
          {error}
        </p>
      )}
      {note && <p className="text-xs text-emerald-400">{note}</p>}

      {/* Configuration. A method with no destination stays greyed out in the
        * store; filling this in is what makes it payable. */}
      <section className={cardClass}>
        <h2 className="text-sm font-medium text-neutral-100">Payment methods</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
          A method is available to buyers once it has an account to pay to. Every payment is
          still verified here by hand before any credits are granted.
        </p>

        <div className="mt-4 space-y-4">
          {methods.map((method) => {
            const unavailable = method.verification === "unavailable";
            return (
              <div
                key={method.id}
                className={cn(
                  "rounded-xl border border-ink-800 bg-ink-950 p-3.5",
                  unavailable && "opacity-60",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-medium text-neutral-100">{method.label}</h3>
                  <span
                    className={cn(
                      "text-[11px]",
                      method.configured ? "text-emerald-400" : "text-neutral-500",
                    )}
                  >
                    {method.configured ? "Available" : (method.unavailableReason ?? "Unavailable")}
                  </span>
                </div>

                {unavailable ? (
                  <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
                    There is no way to take {method.label} payments yet, so it stays greyed out
                    for buyers. It becomes configurable when a real integration is added.
                  </p>
                ) : (
                  <>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`${method.id}-destination`}
                          className="mb-1 block text-[11px] text-neutral-500"
                        >
                          Account number
                        </label>
                        <input
                          id={`${method.id}-destination`}
                          value={value(method, "destination")}
                          onChange={(e) => edit(method.id, { destination: e.target.value })}
                          placeholder="09XX XXX XXXX"
                          className={fieldClass}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`${method.id}-name`}
                          className="mb-1 block text-[11px] text-neutral-500"
                        >
                          Account name
                        </label>
                        <input
                          id={`${method.id}-name`}
                          value={value(method, "account_name")}
                          onChange={(e) => edit(method.id, { account_name: e.target.value })}
                          placeholder="Name shown on the account"
                          className={fieldClass}
                        />
                      </div>
                    </div>

                    <label
                      htmlFor={`${method.id}-instructions`}
                      className="mb-1 mt-2.5 block text-[11px] text-neutral-500"
                    >
                      Instructions, one step per line
                    </label>
                    <textarea
                      id={`${method.id}-instructions`}
                      rows={3}
                      value={value(method, "instructions")}
                      onChange={(e) => edit(method.id, { instructions: e.target.value })}
                      className={cn(fieldClass, "resize-none")}
                    />

                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      {method.qrImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={method.qrImageUrl}
                          alt={`${method.label} QR code`}
                          width={72}
                          height={72}
                          className="rounded-lg border border-ink-800 bg-ink-950 p-1"
                        />
                      ) : (
                        // No QR yet: buyers are told "coming soon" and pay by
                        // number, which works without this being set.
                        <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-700 bg-ink-950 p-1 text-center text-[9px] leading-tight text-neutral-600">
                          No QR yet
                        </div>
                      )}
                      <div className="min-w-0">
                        <label
                          htmlFor={`${method.id}-qr`}
                          className="mb-1 block text-[11px] text-neutral-500"
                        >
                          QR code image
                        </label>
                        <input
                          id={`${method.id}-qr`}
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadQr(method, file);
                          }}
                          className="w-full text-[11px] text-neutral-400 file:mr-3 file:rounded-lg file:border file:border-ink-700 file:bg-ink-850 file:px-3 file:py-1.5 file:text-[11px] file:text-neutral-200"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                        <input
                          type="checkbox"
                          checked={value(method, "enabled")}
                          onChange={(e) => edit(method.id, { enabled: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-ink-700 bg-ink-950"
                        />
                        Offer this method to buyers
                      </label>
                      <button
                        type="button"
                        disabled={savingMethod !== null}
                        onClick={() => void saveMethod(method)}
                        className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-1.5 text-[11px] font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                      >
                        {savingMethod === method.id && (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        )}
                        Save
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        Verification queue
      </h2>

      {orders.length ? (
        orders.map((order) => {
          const open = order.status === "pending" || order.status === "submitted";
          return (
            <section key={order.id} className={cardClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-neutral-100">
                    {nf.format(order.credits)} credits
                    <span className="ml-2 text-xs font-normal text-neutral-500">
                      {price(order.price_cents, order.currency)} · {order.provider}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-[11px] text-neutral-500">
                    {order.account ?? "account deleted"} ·{" "}
                    {new Date(order.created_at).toLocaleString()}
                  </p>
                </div>
                <span className={cn("shrink-0 text-xs", TONE[order.status])}>{order.status}</span>
              </div>

              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex gap-2">
                  <dt className="text-neutral-500">Reference</dt>
                  <dd className="min-w-0 break-all text-neutral-200">
                    {order.reference ?? "— not submitted yet"}
                  </dd>
                </div>
                {order.proofUrl && (
                  <div className="flex gap-2">
                    <dt className="text-neutral-500">Proof</dt>
                    <dd>
                      <a
                        href={order.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-neutral-200 underline decoration-ink-600 underline-offset-2 hover:text-neutral-100"
                      >
                        Open receipt
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </dd>
                  </div>
                )}
                {order.paid_cents !== null && (
                  <div className="flex gap-2">
                    <dt className="text-neutral-500">Payer says they sent</dt>
                    <dd
                      className={cn(
                        "min-w-0",
                        order.paid_cents === order.price_cents
                          ? "text-neutral-200"
                          : "text-amber-400",
                      )}
                    >
                      {price(order.paid_cents, order.currency)}
                      {order.paid_cents !== order.price_cents && " · does not match the price"}
                    </dd>
                  </div>
                )}
                {order.payer_note && (
                  <div className="flex gap-2">
                    <dt className="text-neutral-500">Payer note</dt>
                    <dd className="min-w-0 text-neutral-300">{order.payer_note}</dd>
                  </div>
                )}
                {order.admin_note && (
                  <div className="flex gap-2">
                    <dt className="text-neutral-500">Note</dt>
                    <dd className="min-w-0 text-neutral-300">{order.admin_note}</dd>
                  </div>
                )}
              </dl>

              {open && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={notes[order.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [order.id]: e.target.value }))}
                    placeholder="Note (optional)"
                    aria-label="Admin note"
                    className="min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-ink-600"
                  />
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void review(order.id, "approved")}
                      className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3.5 py-2 text-xs font-medium text-ink-950 transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === order.id && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      )}
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void review(order.id, "rejected")}
                      className="rounded-lg border border-danger/30 px-3.5 py-2 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })
      ) : (
        <p className="text-xs leading-relaxed text-neutral-600">
          No payments yet. Orders appear here as soon as someone submits one.
        </p>
      )}
    </div>
  );
}
