import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import type { Plan, TenantSubscription } from "../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  PlanModel,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "../utils";

const HTTP_CONFLICT = 409;
const FREE_PLAN_PRICE = 0;

export interface FreePlanAvailability {
  isAvailable: boolean;
  blockingWorkspaceName: string | null;
}

export function isFreePlan(plan: Plan): boolean {
  return plan.price <= FREE_PLAN_PRICE;
}

export async function resolveMaxFreeWorkspacesPerCard(): Promise<number> {
  const settings = await GetModel(BillingSettingsModel).get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return (
    settings?.maxFreeWorkspacesPerCard ?? DEFAULT_MAX_FREE_WORKSPACES_PER_CARD
  );
}

async function keepFreeSubscriptions(
  subscriptions: TenantSubscription[],
): Promise<TenantSubscription[]> {
  const planIds = [
    ...new Set(
      subscriptions
        .map((sub) => sub.planId)
        .filter((planId): planId is string => !!planId),
    ),
  ];
  if (planIds.length === 0) return [];
  const planModel = GetModel(PlanModel);
  const plans = await Promise.all(
    planIds.map((planId) => planModel.get(planId)),
  );
  const freePlanIds = new Set(
    plans
      .filter((plan): plan is Plan => !!plan && isFreePlan(plan))
      .map((plan) => plan._id),
  );
  return subscriptions.filter(
    (sub) => sub.planId && freePlanIds.has(sub.planId),
  );
}

async function resolveWorkspaceNames(
  subscriptions: TenantSubscription[],
): Promise<string[]> {
  const tenantIds = subscriptions.map((sub) => getRowInstance(sub));
  const tenants = await GetModel(TenantModel).getMany(tenantIds);
  return tenants.map((tenant) => tenant.name);
}

async function findFreeWorkspacesBackedByCard(
  cardFingerprint: string,
): Promise<string[]> {
  const subscriptions = await GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  ).findByCardFingerprint(cardFingerprint);
  const freeSubscriptions = await keepFreeSubscriptions(subscriptions);
  if (freeSubscriptions.length === 0) return [];
  return resolveWorkspaceNames(freeSubscriptions);
}

/** Count durable subscription identities, including workspaces whose creation is incomplete. */
export async function findFreeWorkspaceIdsBackedByCard(
  cardFingerprint: string,
): Promise<string[]> {
  const subscriptions = await GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  ).findByCardFingerprint(cardFingerprint);
  const freeSubscriptions = await keepFreeSubscriptions(subscriptions);
  return [
    ...new Set(
      freeSubscriptions.map((subscription) => getRowInstance(subscription)),
    ),
  ];
}

/**
 * Authoritative check, run against the card actually confirmed by the caller.
 * `resolveFreePlanAvailabilityForUser` only pre-computes the same rule for the
 * creation form, where the card is not known yet.
 */
export async function assertFreePlanAllowedForCard(
  plan: Plan,
  cardFingerprint: string | null,
): Promise<void> {
  if (!isFreePlan(plan) || !cardFingerprint) return;
  const [limit, workspaceNames] = await Promise.all([
    resolveMaxFreeWorkspacesPerCard(),
    findFreeWorkspacesBackedByCard(cardFingerprint),
  ]);
  assert(
    workspaceNames.length < limit,
    HTTP_CONFLICT,
    "saas.errors.workspace.free_limit_reached",
  );
}

async function collectUserCardFingerprints(
  userId: string,
): Promise<Set<string>> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  const subscriptions = await Promise.all(
    memberships.map((membership) =>
      GetModel(TenantSubscriptionModel, membership.tenantId).findOne(),
    ),
  );
  const fingerprints = subscriptions
    .map((subscription) => subscription?.cardFingerprint)
    .filter((fingerprint): fingerprint is string => !!fingerprint);
  return new Set(fingerprints);
}

/**
 * Free stays offered as long as one known card still has room — the card is
 * only chosen at submit time, and an unknown card is always allowed. The name
 * reported is the one the form shows to explain the disabled option.
 */
export function resolveFreePlanAvailability(
  freeWorkspaceNamesPerCard: string[][],
  limit: number,
): FreePlanAvailability {
  if (freeWorkspaceNamesPerCard.length === 0) {
    return { isAvailable: true, blockingWorkspaceName: null };
  }
  const hasCardWithRoom = freeWorkspaceNamesPerCard.some(
    (workspaceNames) => workspaceNames.length < limit,
  );
  if (hasCardWithRoom) {
    return { isAvailable: true, blockingWorkspaceName: null };
  }
  return {
    isAvailable: false,
    blockingWorkspaceName: freeWorkspaceNamesPerCard.flat()[0] ?? null,
  };
}

export async function resolveFreePlanAvailabilityForUser(
  userId: string,
): Promise<FreePlanAvailability> {
  const fingerprints = await collectUserCardFingerprints(userId);
  const [limit, usages] = await Promise.all([
    resolveMaxFreeWorkspacesPerCard(),
    Promise.all(
      [...fingerprints].map((fingerprint) =>
        findFreeWorkspacesBackedByCard(fingerprint),
      ),
    ),
  ]);
  return resolveFreePlanAvailability(usages, limit);
}
