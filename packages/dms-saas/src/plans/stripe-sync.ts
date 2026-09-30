import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { PLAN_INTERVALS, type Plan, PlanModel } from "../db";
import { isStripeConfigured } from "../stripe/client";
import {
  isPlanStripeSyncCurrent,
  resolveProductTaxCode,
  syncPlanWithStripe,
} from "../stripe/sync-plan";

const LOG_PREFIX = "[dms-saas:plans]";
const SUPPORTED_INTERVALS = new Set<string>(PLAN_INTERVALS);

/** The part of the plan model syncing a plan writes through. */
export type PlanRefsStore = Pick<PlanModel, "update">;

/** The plan fields a sync reads: callers agreeing on them share one sync. */
const SYNC_INPUT_FIELDS = [
  "_id",
  "createdAt",
  "name",
  "description",
  "price",
  "currency",
  "interval",
  "billingMode",
  "paymentProviderRefs",
] as const satisfies readonly (keyof Plan)[];

const inFlightSyncs = new Map<string, Promise<Plan>>();

function syncInputKey(plan: Plan): string {
  return JSON.stringify(SYNC_INPUT_FIELDS.map((field) => plan[field]));
}

/**
 * Whether a plan is billed through Stripe: it has a price, or it is already
 * linked to a Stripe price its subscriptions may be billed on. A plan priced
 * 0 that never was stays off Stripe.
 */
function isStripeBilledPlan(plan: Plan): boolean {
  return plan.price > 0 || !!plan.paymentProviderRefs?.stripePriceId;
}

function canSyncWithStripe(plan: Plan): boolean {
  return (
    isStripeBilledPlan(plan) &&
    !plan.isDeleted &&
    SUPPORTED_INTERVALS.has(plan.interval)
  );
}

async function syncAndStore(store: PlanRefsStore, plan: Plan): Promise<Plan> {
  const taxCode = await resolveProductTaxCode();
  if (isPlanStripeSyncCurrent(plan, taxCode)) return plan;
  const paymentProviderRefs = await syncPlanWithStripe(plan, taxCode);
  // Only the refs are written, so a concurrent edit of the plan is never
  // rolled back; a sync that raced one is out of line again and redone.
  await store.update(plan._id, { paymentProviderRefs });
  Logging.Info(
    `${LOG_PREFIX} plan '${plan._id}' synced with Stripe price ${paymentProviderRefs.stripePriceId}`,
  );
  // The spread row is an AntelopeJS table class: `Table` declares one field
  // and a static, no instance methods. There is no prototype to lose.
  // oxlint-disable-next-line typescript/no-misused-spread
  return { ...plan, paymentProviderRefs };
}

/**
 * Brings a plan's Stripe product and price in line with the plan and stores
 * the refs, whoever wrote the plan. A plan off Stripe, already in line, or
 * with Stripe not configured is returned untouched. Concurrent calls for the
 * same version of a plan share a single sync. Provider errors propagate.
 *
 * @param plan Plan as stored
 * @param store Plan model the refs are written through
 * @returns The plan with the refs it now holds
 */
export async function syncPlanStripeRefs(
  plan: Plan,
  store: PlanRefsStore = GetModel(PlanModel),
): Promise<Plan> {
  if (!canSyncWithStripe(plan) || !isStripeConfigured()) return plan;
  const key = syncInputKey(plan);
  const running = inFlightSyncs.get(key);
  if (running) return running;
  const sync = syncAndStore(store, plan).finally(() =>
    inFlightSyncs.delete(key),
  );
  inFlightSyncs.set(key, sync);
  return sync;
}

/**
 * {@link syncPlanStripeRefs} for the paths that read a plan to bill or offer
 * it: a failure is logged and the plan returned as stored, so the caller's own
 * checks decide whether it can be billed.
 *
 * @param plan Plan as stored
 * @param store Plan model the refs are written through
 */
export async function ensurePlanStripeRefs(
  plan: Plan,
  store: PlanRefsStore = GetModel(PlanModel),
): Promise<Plan> {
  try {
    return await syncPlanStripeRefs(plan, store);
  } catch (error) {
    Logging.Error(`${LOG_PREFIX} plan '${plan._id}' Stripe sync failed`, error);
    return plan;
  }
}

/**
 * Reads a plan about to be billed, synced with Stripe first.
 *
 * @param planId Id of the plan
 */
export async function loadBillablePlan(
  planId: string,
): Promise<Plan | undefined> {
  const model = GetModel(PlanModel);
  const plan = await model.get(planId);
  return plan && ensurePlanStripeRefs(plan, model);
}

/**
 * Syncs every active plan with Stripe, one at a time. Run at boot: it links
 * plans written while dms-saas was down or by a module writing the plan table
 * directly, and repairs any sync an earlier failure left behind.
 */
export async function reconcilePlansWithStripe(): Promise<void> {
  if (!isStripeConfigured()) {
    Logging.Warn(
      `${LOG_PREFIX} Stripe not configured (placeholder key) — skipping plan reconciliation`,
    );
    return;
  }
  const model = GetModel(PlanModel);
  const plans = await model.findActiveNotDeleted();
  for (const plan of plans) {
    await ensurePlanStripeRefs(plan, model);
  }
}
