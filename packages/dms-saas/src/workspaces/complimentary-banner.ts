import type { BannerContent, BannerTone } from "@antelopejs/interface-dms/base";
import { BLOCKING_STATUSES } from "../auth/subscription-access-gate";
import type { TenantSubscription } from "../db";
import { composed, countParam, dateParam } from "../i18n/composed-text";
import { MS_PER_DAY } from "../utils/time";
import { isComplimentarySubscription } from "./complimentary";

/** Where a complimentary access stands: open-ended, ending, or over. */
type ComplimentaryState = "indefinite" | "ending" | "expired";

/** What the billing page's complimentary banner is built from. */
export interface ComplimentaryBannerInputs {
  subscription: TenantSubscription | null | undefined;
  workspaceName: string;
  planName: string;
  /** Only an owner is offered to choose a plan. */
  isTenantOwner: boolean;
  now: Date;
}

interface ComplimentaryLook {
  tone: BannerTone;
  icon: string;
  canChoosePlan: boolean;
}

const K = "saas.tenant_billing.complimentary";

/**
 * The anchor the plan card answers by opening its plan comparison in place
 * (see `TenantPlanCard`): a banner action is a link, and the comparison
 * lives in the plan card next to it.
 */
export const CHOOSE_PLAN_ANCHOR = "#choose-plan";

const LOOKS: Record<ComplimentaryState, ComplimentaryLook> = {
  indefinite: { tone: "info", icon: "i-ph-gift", canChoosePlan: false },
  ending: {
    tone: "warning",
    icon: "i-ph-hourglass-medium",
    canChoosePlan: true,
  },
  expired: {
    tone: "error",
    icon: "i-ph-warning-circle",
    canChoosePlan: true,
  },
};

function stateOf(
  subscription: TenantSubscription | null | undefined,
): ComplimentaryState | null {
  if (!subscription || !isComplimentarySubscription(subscription)) return null;
  if (BLOCKING_STATUSES.has(subscription.status)) return "expired";
  return subscription.freeUntil ? "ending" : "indefinite";
}

/** Whole days until `date`, a started day counting as one; 0 once passed. */
function daysUntil(date: Date, now: Date): number {
  const remaining = date.getTime() - now.getTime();
  return remaining > 0 ? Math.ceil(remaining / MS_PER_DAY) : 0;
}

type BannerTexts = Pick<BannerContent, "title" | "description">;

function textsOf(
  state: ComplimentaryState,
  inputs: ComplimentaryBannerInputs,
): BannerTexts {
  const freeUntil = inputs.subscription?.freeUntil ?? null;
  const date = freeUntil ? dateParam(freeUntil, "day") : null;
  const texts: Record<ComplimentaryState, () => BannerTexts> = {
    indefinite: () => ({
      title: `$${K}.indefinite_title`,
      description: composed(`${K}.indefinite_description`, {
        workspace: inputs.workspaceName,
        plan: inputs.planName,
      }),
    }),
    ending: () => ({
      title: composed(`${K}.ending_title`, { date: date! }),
      description: composed(`${K}.ending_description`, {
        days: countParam(daysUntil(new Date(freeUntil!), inputs.now)),
      }),
    }),
    expired: () => ({
      title: date
        ? composed(`${K}.expired_title_on`, { date })
        : `$${K}.expired_title`,
      description: `$${K}.expired_description`,
    }),
  };
  return texts[state]();
}

/**
 * The billing page's complimentary access banner, or `null` for a workspace
 * that pays: an open-ended gift is announced, an ending or expired one warns
 * and offers its owner to choose a plan.
 */
export function complimentaryBanner(
  inputs: ComplimentaryBannerInputs,
): BannerContent | null {
  const state = stateOf(inputs.subscription);
  if (!state) return null;
  const look = LOOKS[state];
  const canChoosePlan = look.canChoosePlan && inputs.isTenantOwner;
  return {
    tone: look.tone,
    icon: look.icon,
    ...textsOf(state, inputs),
    actions: canChoosePlan
      ? [
          {
            label: `$${K}.choose_plan`,
            icon: "i-ph-stack",
            to: CHOOSE_PLAN_ANCHOR,
          },
        ]
      : [],
  };
}
