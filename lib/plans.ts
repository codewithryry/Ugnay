/**
 * Ugnay subscription plans.
 *
 * This is presentation-only: no billing provider is connected yet, so every
 * account is on the Free plan. When payments are added, replace `CURRENT_PLAN`
 * with the tier read from the user's subscription record and give each paid
 * plan a real checkout target — the rest of the pricing page needs no changes.
 */

export type PlanId = "free" | "plus" | "pro" | "ultra";
export type BillingCycle = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** USD per month when billed monthly. */
  monthly: number;
  /** USD per month when billed yearly, charged annually. */
  yearlyMonthly: number;
  cta: string;
  recommended?: boolean;
  features: string[];
}

/** The only tier that exists today. Paid tiers are not purchasable yet. */
export const CURRENT_PLAN: PlanId = "free";

/** Yearly billing discount, applied to the paid tiers. */
export const YEARLY_DISCOUNT = 0.2;

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Ugnay Free",
    tagline: "Everything you need to start chatting.",
    monthly: 0,
    yearlyMonthly: 0,
    cta: "Current plan",
    features: [
      "Access to free community models",
      "Standard usage limits",
      "Standard response speed",
      "Custom instructions and saved presets",
      "Full chat history",
    ],
  },
  {
    id: "plus",
    name: "Ugnay Plus",
    tagline: "More capable models for everyday work.",
    monthly: 10,
    yearlyMonthly: 8,
    cta: "Choose Plus",
    recommended: true,
    features: [
      "Access to mid-tier paid models",
      "Higher usage limits",
      "Faster responses at peak times",
      "File uploads in chat",
      "Everything in Free",
    ],
  },
  {
    id: "pro",
    name: "Ugnay Pro",
    tagline: "Frontier models and longer context.",
    monthly: 30,
    yearlyMonthly: 24,
    cta: "Choose Pro",
    features: [
      "Access to frontier models",
      "Substantially higher usage limits",
      "Priority response speed",
      "File and image understanding",
      "Extended context windows",
      "Everything in Plus",
    ],
  },
  {
    id: "ultra",
    name: "Ugnay Ultra",
    tagline: "Maximum limits for heavy, sustained use.",
    monthly: 100,
    yearlyMonthly: 80,
    cta: "Choose Ultra",
    features: [
      "Access to every model Ugnay supports",
      "Highest usage limits",
      "Fastest response speed",
      "File, image, and long-document workflows",
      "Early access to new features",
      "Everything in Pro",
    ],
  },
];

export function priceFor(plan: Plan, cycle: BillingCycle) {
  return cycle === "yearly" ? plan.yearlyMonthly : plan.monthly;
}
