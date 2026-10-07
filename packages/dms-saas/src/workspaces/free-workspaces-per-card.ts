import { assert } from "@antelopejs/interface-api-util";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "../utils";
import { isFreePlan } from "./free-plan";

const HTTP_CONFLICT = 409;
const POLICY_DISABLED_LIMIT = 0;

/**
 * Free workspaces a single card may back, from the billing rules. Zero turns
 * the rule off: a free workspace is then created without any card.
 */
export async function resolveFreeWorkspacesPerCard(): Promise<number> {
  const settings = await GetModel(BillingSettingsModel).get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return (
    settings?.maxFreeWorkspacesPerCard ?? DEFAULT_MAX_FREE_WORKSPACES_PER_CARD
  );
}

/** Whether the rule is on, i.e. whether a free workspace asks for a card. */
export function isFreePerCardPolicyActive(limit: number): boolean {
  return limit > POLICY_DISABLED_LIMIT;
}

async function isOnFreePlan(
  subscription: TenantSubscription,
): Promise<boolean> {
  if (!subscription.planId || subscription.isComplimentary) return false;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  return !!plan && isFreePlan(plan);
}

/**
 * The live workspaces a card already backs on a free plan. A complimentary
 * workspace is the platform's gift, not the card's, so it is not counted.
 *
 * @returns Their tenant ids
 */
export async function listFreeWorkspacesBackedByCard(
  fingerprint: string,
): Promise<string[]> {
  const subscriptions = await GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  ).findByCardFingerprint(fingerprint);
  const verdicts = await Promise.all(subscriptions.map(isOnFreePlan));
  return subscriptions
    .filter((_, index) => verdicts[index])
    .map((subscription) => getRowInstance(subscription));
}

/**
 * Refuses a free workspace once its card backs as many as the billing rules
 * allow: the visitor is asked for a paid plan or another card instead.
 *
 * @throws 409 `saas.errors.workspace.free_card_limit_reached`
 */
export async function assertCardMayBackFreeWorkspace(
  fingerprint: string,
  limit: number,
): Promise<void> {
  const backed = await listFreeWorkspacesBackedByCard(fingerprint);
  assert(
    backed.length < limit,
    HTTP_CONFLICT,
    "saas.errors.workspace.free_card_limit_reached",
  );
}

const cardsInFlight = new Set<string>();

/**
 * Runs a creation while holding its card, so two creations racing with the
 * same card cannot both pass the per-card count. The hold is per process: a
 * deployment running several API instances still relies on the count alone.
 *
 * @throws 409 `saas.errors.workspace.creation_in_progress` while another
 *   creation holds the card
 */
export async function withCardHold<T>(
  fingerprint: string | null,
  work: () => Promise<T>,
): Promise<T> {
  if (!fingerprint) return work();
  assert(
    !cardsInFlight.has(fingerprint),
    HTTP_CONFLICT,
    "saas.errors.workspace.creation_in_progress",
  );
  cardsInFlight.add(fingerprint);
  try {
    return await work();
  } finally {
    cardsInFlight.delete(fingerprint);
  }
}
