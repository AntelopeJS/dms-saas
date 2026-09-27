import type { Plan, TenantSubscription } from "../db";
import { isStripeConfigured } from "../stripe/client";
import { isComplimentarySubscription } from "../workspaces/complimentary";
import { isFreePlan } from "../workspaces/free-workspace-guard";
import { absent, type PreviewOutcome, unavailable } from "./outcomes";

/** A subscription Stripe can preview the next invoice of. */
export interface PreviewableSubscription {
  subscription: TenantSubscription;
  customerId: string;
  subscriptionId: string;
}

/** Local state lets Stripe be asked for the next invoice. */
export interface PreviewableEligibility {
  isPreviewable: true;
  target: PreviewableSubscription;
}

/** Local state already answers: there is nothing Stripe could price. */
export interface SettledEligibility {
  isPreviewable: false;
  outcome: PreviewOutcome;
}

/** What the local billing state says about the workspace's next invoice. */
export type PreviewEligibility = PreviewableEligibility | SettledEligibility;

interface EligibilityRule {
  outcome: PreviewOutcome;
  applies: (
    subscription: TenantSubscription,
    plan: Plan | undefined,
  ) => boolean;
}

// Evaluated in order: a gift is reported as such whatever plan it carries, and
// a free plan before the Stripe objects a free workspace never has.
const ELIGIBILITY_RULES: EligibilityRule[] = [
  {
    outcome: absent("complimentary"),
    applies: (subscription) => isComplimentarySubscription(subscription),
  },
  {
    outcome: absent("subscription_not_configured"),
    applies: (_subscription, plan) => !plan,
  },
  {
    outcome: absent("free_plan"),
    applies: (_subscription, plan) => !!plan && isFreePlan(plan),
  },
  {
    outcome: absent("customer_not_configured"),
    applies: (subscription) => !subscription.stripeCustomerId,
  },
];

function toPreviewable(
  subscription: TenantSubscription,
): PreviewableSubscription | null {
  const { stripeCustomerId, stripeSubscriptionId } = subscription;
  if (!stripeCustomerId || !stripeSubscriptionId) return null;
  return {
    subscription,
    customerId: stripeCustomerId,
    subscriptionId: stripeSubscriptionId,
  };
}

function settled(outcome: PreviewOutcome): SettledEligibility {
  return { isPreviewable: false, outcome };
}

/**
 * Decide from local state alone whether Stripe has a next invoice to price,
 * so free, gifted and unconfigured workspaces never cost a Stripe call.
 */
export function resolvePreviewEligibility(
  subscription: TenantSubscription | undefined,
  plan: Plan | undefined,
): PreviewEligibility {
  if (!subscription) return settled(absent("subscription_not_configured"));
  const rule = ELIGIBILITY_RULES.find((candidate) =>
    candidate.applies(subscription, plan),
  );
  if (rule) return settled(rule.outcome);
  const target = toPreviewable(subscription);
  if (!target) return settled(absent("subscription_not_configured"));
  if (!isStripeConfigured())
    return settled(unavailable("stripe_not_configured"));
  return { isPreviewable: true, target };
}
