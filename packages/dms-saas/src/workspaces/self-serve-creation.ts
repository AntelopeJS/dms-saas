import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  type PlanBillingMode,
  type PlanInterval,
  PlanModel,
  TenantSubscriptionModel,
  TrialConsumptionModel,
} from "../db";
import { hashEmail } from "../utils";
import { resolveBillingProfileForNewWorkspace } from "./billing-profile";
import { isFreePlan } from "./free-plan";
import {
  assertCardMayBackFreeWorkspace,
  isFreePerCardPolicyActive,
  resolveFreeWorkspacesPerCard,
} from "./free-workspaces-per-card";
import {
  assertBillingCountry,
  type CardDetails,
  type WorkspaceBillingProfile,
  type WorkspaceCustomerType,
} from "./provisioning";

const HTTP_BAD_REQUEST = 400;
const NO_TRIAL_DAYS = 0;
const CANCELLED_STATUS = "cancelled";
const NO_CARD: CardDetails = { fingerprint: null, billingAddress: undefined };

/**
 * Why a plan asks for a card when a workspace is created on it: `payment` for
 * a paid plan, `verification` for a free one under the per-card rule (never
 * charged), `none` for a free one when the rule is off.
 */
export type CardRequirement = "none" | "payment" | "verification";

/** One plan of the creation form, with what choosing it asks for. */
export interface WorkspaceCreatePlanOption {
  _id: string;
  name: string;
  description: string;
  /** Minor units, as stored. */
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

/** The per-card rule of free workspaces, as the form explains it. */
export interface FreePerCardRule {
  limit: number;
  /** The caller's own free workspaces that already rest on a card. */
  usedBy: string[];
}

/** Everything the creation form decides from, worded by the server. */
export interface WorkspaceCreateOptions {
  plans: WorkspaceCreatePlanOption[];
  freePerCard: FreePerCardRule | null;
}

/** The card requirement of a plan under the current per-card rule. */
export function cardRequirementOf(
  plan: Plan,
  freeWorkspacesPerCard: number,
): CardRequirement {
  if (!isFreePlan(plan)) return "payment";
  return isFreePerCardPolicyActive(freeWorkspacesPerCard)
    ? "verification"
    : "none";
}

function isOfferedTo(plan: Plan, customerType: WorkspaceCustomerType): boolean {
  return plan.audience === "any" || plan.audience === customerType;
}

function toPlanOption(
  plan: Plan,
  freeWorkspacesPerCard: number,
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
    cardRequirement: cardRequirementOf(plan, freeWorkspacesPerCard),
  };
}

async function listOwnedTenantIds(userId: string): Promise<string[]> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  return memberships
    .filter((membership) => membership.member.isTenantOwner)
    .map((membership) => membership.tenantId);
}

async function isCardBackedFreeWorkspace(tenantId: string): Promise<boolean> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription?.cardFingerprint || !subscription.planId) return false;
  if (subscription.status === CANCELLED_STATUS) return false;
  if (subscription.isComplimentary) return false;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  return !!plan && isFreePlan(plan);
}

/**
 * The names of the caller's free workspaces resting on a card. The card the
 * caller is about to type is not known yet, so this only tells them which of
 * their cards are likely spent; the count itself runs on submit.
 */
async function listCardBackedFreeWorkspaceNames(
  userId: string,
): Promise<string[]> {
  const tenantIds = await listOwnedTenantIds(userId);
  const verdicts = await Promise.all(tenantIds.map(isCardBackedFreeWorkspace));
  const backed = tenantIds.filter((_, index) => verdicts[index]);
  const tenants = await GetModel(TenantModel).getMany(backed);
  return tenants.map((tenant) => tenant.name);
}

async function resolveFreePerCardRule(
  userId: string,
  limit: number,
): Promise<FreePerCardRule | null> {
  if (!isFreePerCardPolicyActive(limit)) return null;
  return { limit, usedBy: await listCardBackedFreeWorkspaceNames(userId) };
}

/**
 * The plans a user may create a workspace on, each with the card it asks for
 * and the trial they would get, and the per-card rule of free workspaces.
 * The submit route applies the very same rules.
 */
export async function buildWorkspaceCreateOptions(
  user: User,
  preferredTenantId?: string,
): Promise<WorkspaceCreateOptions> {
  const [plans, profile, limit, hasUsedTrial] = await Promise.all([
    GetModel(PlanModel).findPubliclyVisible(),
    resolveBillingProfileForNewWorkspace(user._id, NO_CARD, preferredTenantId),
    resolveFreeWorkspacesPerCard(),
    GetModel(TrialConsumptionModel).existsForIdentity(
      hashEmail(user.email),
      null,
    ),
  ]);
  return {
    plans: plans
      .filter((plan) => isOfferedTo(plan, profile.customerType))
      .sort((a, b) => a.order - b.order)
      .map((plan) => toPlanOption(plan, limit, hasUsedTrial)),
    freePerCard: await resolveFreePerCardRule(user._id, limit),
  };
}

/** What a creation sends along: the card it was asked for, if any. */
export interface SelfServeCardInput {
  requirement: CardRequirement;
  paymentMethodId: string | undefined;
  card: CardDetails;
  billingProfile: WorkspaceBillingProfile;
  freeWorkspacesPerCard: number;
}

/**
 * The card provisioning goes on with. Only a paid plan hands its payment
 * method over to be charged; a free plan's card only proves who backs the
 * workspace, so its fingerprint is kept and nothing is created at Stripe.
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
  verification: async ({ paymentMethodId, card, freeWorkspacesPerCard }) => {
    assertCardSent(paymentMethodId);
    assertCardSent(card.fingerprint);
    await assertCardMayBackFreeWorkspace(
      card.fingerprint as string,
      freeWorkspacesPerCard,
    );
    return { paymentMethodId: undefined, card };
  },
  none: async () => ({ paymentMethodId: undefined, card: NO_CARD }),
};

/**
 * Applies the card rule of the chosen plan, the same one the creation form
 * was told about.
 *
 * @throws 400 `saas.errors.workspace.payment_method_required` without the card
 *   the plan asks for, 400 `saas.errors.billing.country_required` for a paid
 *   plan without a billing country, 409
 *   `saas.errors.workspace.free_card_limit_reached` once the card backs as
 *   many free workspaces as allowed
 */
export function resolveSelfServeCardUse(
  input: SelfServeCardInput,
): Promise<SelfServeCardUse> {
  return CARD_USES[input.requirement](input);
}
