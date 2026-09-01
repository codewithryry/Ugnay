"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CURRENT_PLAN,
  PLANS,
  YEARLY_DISCOUNT,
  formatPeso,
  priceFor,
  type BillingCycle,
} from "@/lib/plans";

export default function PricingPlans() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-safe pt-safe sm:px-6">
      <div className="flex items-center justify-between gap-4 pt-8 sm:pt-10">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-neutral-400 transition hover:bg-ink-850 hover:text-neutral-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to Ugnay
        </Link>
      </div>

      <div className="mt-8 text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-tight text-neutral-100 xs:text-3xl sm:text-4xl">
          Upgrade your plan
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-neutral-500">
          Pick the level of model access and usage that fits how you work. Free stays free — no
          card required. Credits can be topped up today; the paid tiers are not open yet.
        </p>
      </div>

      <Link
        href="/credits"
        className="mx-auto mt-7 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-ink-800 bg-ink-900 px-4 py-3.5 transition hover:border-ink-700 hover:bg-ink-850"
      >
        <Coins className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-neutral-100">Buy Ugnay Credits</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
            Top up with PayPal or GCash, in pesos. Credits are what AI replies are charged
            against — available now, while the plans below are not.
          </span>
        </span>
        <span className="shrink-0 text-xs text-neutral-400">Open store</span>
      </Link>

      <div
        role="group"
        aria-label="Billing cycle"
        className="mx-auto mt-7 flex w-fit items-center gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1"
      >
        {(["monthly", "yearly"] as BillingCycle[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCycle(option)}
            aria-pressed={cycle === option}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-sm transition",
              cycle === option
                ? "bg-ink-800 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200",
            )}
          >
            {option === "monthly" ? "Monthly" : "Yearly"}
            {option === "yearly" && (
              <span className="ml-2 rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-medium text-success">
                Save {Math.round(YEARLY_DISCOUNT * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const price = priceFor(plan, cycle);
          const isCurrent = plan.id === CURRENT_PLAN;
          const available = isCurrent; // Paid tiers have no checkout yet.

          return (
            <section
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
              className={cn(
                "flex min-w-0 flex-col rounded-2xl border bg-ink-900 p-4 sm:p-5",
                plan.recommended ? "border-neutral-500" : "border-ink-800",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 id={`plan-${plan.id}`} className="text-sm font-semibold text-neutral-100">
                  {plan.name}
                </h2>
                {plan.recommended && (
                  <span className="shrink-0 rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-neutral-200">
                    Recommended
                  </span>
                )}
                {isCurrent && !plan.recommended && (
                  <span className="shrink-0 rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-neutral-400">
                    Current plan
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{plan.tagline}</p>

              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight text-neutral-100">
                  {formatPeso(price)}
                </span>
                <span className="text-xs text-neutral-500">/ month</span>
              </p>
              <p className="mt-1 min-h-[1rem] text-[11px] text-neutral-600">
                {cycle === "yearly" && price > 0
                  ? `Billed yearly at ${formatPeso(price * 12)}`
                  : cycle === "yearly"
                    ? "Free forever"
                    : ""}
              </p>

              {available ? (
                <p className="mt-4 rounded-xl border border-ink-700 px-3 py-2 text-center text-xs text-neutral-300">
                  {plan.cta}
                </p>
              ) : (
                <button
                  type="button"
                  disabled
                  title="Paid plans are not available yet"
                  className={cn(
                    "mt-4 rounded-xl px-3 py-2 text-center text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60",
                    plan.recommended
                      ? "bg-neutral-100 text-ink-950"
                      : "border border-ink-700 text-neutral-300",
                  )}
                >
                  {plan.cta}
                </button>
              )}

              <ul className="mt-5 space-y-2 border-t border-ink-800 pt-4">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-xs leading-relaxed text-neutral-400">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-600" aria-hidden />
                    {feature}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mx-auto mb-10 mt-8 max-w-2xl text-center text-xs leading-relaxed text-neutral-600">
        Subscriptions are not open yet, so every account stays on Ugnay Free. Credits are the
        way to pay for usage today — buy them in the store above, or earn them from the daily
        claim and tasks in your wallet.
      </p>
    </div>
  );
}
