import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  type PlanBillingMode,
  type PlanInterval,
  PlanModel,
  TrialConsumptionModel,
} from "../db";
import { hashEmail } from "../utils";
import { resolveBillingProfileForNewWorkspace } from "./billing-profile";
import { isFreePlan } from "./free-plan";
import {
  assertBillingCountry,
  type CardDetails,
  type WorkspaceBillingProfile,
} from "./provisioning";
import { isPlanOfferedTo } from "../plans/plan-audience";

const HTTP_BAD_REQUEST = 400;
const NO_TRIAL_DAYS = 0;
const NO_CARD: CardDetails = { fingerprint: null, billingAddress: undefined };

/**
 * Whether a plan asks for a card when a workspace is created on it: `payment`
 * for a paid plan, `none` for a free one.
 */
export type CardRequirement = "none" | "payment";

/** One plan of the creation form, with what choosing it asks for. */
export interface WorkspaceCreatePlanOption {
  _id: string;
  name: string;
  description: string;
  /** Major units, as plans store it (`49` euros). */
  price: number;
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
  /** The trial this user would get: zero once their e-mail used one. */
  trialDays: number;
  /** -1 means unlimited. */
  maxMembers: number;
  cardRequirement: CardRequirement;
}

/** Everything the creation form decides from, worded by the server. */
export interface WorkspaceCreateOptions {
  plans: WorkspaceCreatePlanOption[];
}

/** The card requirement of a plan. */
export function cardRequirementOf(plan: Plan): CardRequirement {
  return isFreePlan(plan) ? "none" : "payment";
}

function toPlanOption(
  plan: Plan,
  hasUsedTrial: boolean,
): WorkspaceCreatePlanOption {
  return {
    _id: plan._id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    trialDays: hasUsedTrial ? NO_TRIAL_DAYS : plan.trialDays,
    maxMembers: plan.maxMembers,
    cardRequirement: cardRequirementOf(plan),
  };
}

/**
 * The plans a user may create a workspace on, each with the card it asks for
 * and the trial they would get. The submit route applies the very same rules.
 */
export async function buildWorkspaceCreateOptions(
  user: User,
  preferredTenantId?: string,
): Promise<WorkspaceCreateOptions> {
  const [plans, profile, hasUsedTrial] = await Promise.all([
    GetModel(PlanModel).findPubliclyVisible(),
    resolveBillingProfileForNewWorkspace(user._id, NO_CARD, preferredTenantId),
    GetModel(TrialConsumptionModel).existsForIdentity(
      hashEmail(user.email),
      null,
    ),
  ]);
  return {
    plans: plans
      .filter((plan) => isPlanOfferedTo(plan, profile.customerType))
      .sort((a, b) => a.order - b.order)
      .map((plan) => toPlanOption(plan, hasUsedTrial)),
  };
}

/** What a creation sends along: the card it was asked for, if any. */
export interface SelfServeCardInput {
  requirement: CardRequirement;
  paymentMethodId: string | undefined;
  card: CardDetails;
  billingProfile: WorkspaceBillingProfile;
}

/**
 * The card provisioning goes on with. Only a paid plan hands its payment
 * method over to be charged; a free plan goes on without any card.
 */
export interface SelfServeCardUse {
  paymentMethodId: string | undefined;
  card: CardDetails;
}

function assertCardSent(value: string | null | undefined): void {
  assert(
    value,
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.payment_method_required",
  );
}

const CARD_USES: Record<
  CardRequirement,
  (input: SelfServeCardInput) => Promise<SelfServeCardUse>
> = {
  payment: async ({ paymentMethodId, card, billingProfile }) => {
    assertCardSent(paymentMethodId);
    assertBillingCountry(billingProfile.address);
    return { paymentMethodId, card };
  },
  none: async () => ({ paymentMethodId: undefined, card: NO_CARD }),
};

/**
 * Applies the card rule of the chosen plan, the same one the creation form
 * was told about.
 *
 * @throws 400 `saas.errors.workspace.payment_method_required` without the card
 *   the plan asks for, 400 `saas.errors.billing.country_required` for a paid
 *   plan without a billing country
 */
export function resolveSelfServeCardUse(
  input: SelfServeCardInput,
): Promise<SelfServeCardUse> {
  return CARD_USES[input.requirement](input);
}
