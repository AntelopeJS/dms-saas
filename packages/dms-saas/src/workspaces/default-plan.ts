import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { recomputeTenantBillingState } from "../billing-state";
import { getDefaultPlanSlug } from "../config";
import {
  type Plan,
  type PlanAudience,
  PlanModel,
  TenantSubscriptionModel,
} from "../db";
import { isFreePlan } from "./free-workspace-guard";

const LOG_PREFIX = "[dms-saas:default-plan]";
const ACTIVE_STATUS = "active" as const;
// A workspace that falls back on the default plan has no billing identity
// yet, so a plan reserved to businesses cannot be the one it lands on.
const DEFAULT_PLAN_AUDIENCES = new Set<PlanAudience>(["any", "individual"]);

function isDefaultPlanCandidate(plan: Plan): boolean {
  return (
    plan.isActive &&
    !plan.isDeleted &&
    isFreePlan(plan) &&
    DEFAULT_PLAN_AUDIENCES.has(plan.audience)
  );
}

/**
 * Picks the plan a workspace without one falls back on.
 *
 * @param plans Catalogue to choose from
 * @param configuredSlug Operator's explicit choice, honoured when it names a
 *   usable free plan
 * @returns The configured plan, else the lowest-ordered active free plan open
 *   to individuals, else null when the catalogue has none
 */
export function selectDefaultPlan(
  plans: Plan[],
  configuredSlug?: string,
): Plan | null {
  const candidates = plans
    .filter(isDefaultPlanCandidate)
    .sort((left, right) => left.order - right.order);
  if (!configuredSlug) return candidates[0] ?? null;
  const configured = candidates.find((plan) => plan.slug === configuredSlug);
  if (!configured) {
    Logging.Warn(
      `${LOG_PREFIX} defaultPlanSlug "${configuredSlug}" names no active free plan; falling back to the lowest-ordered one`,
    );
  }
  return configured ?? candidates[0] ?? null;
}

// The billing page covers a plan-less workspace on every read: without this
// latch, an empty catalogue would log once per page view.
let hasWarnedMissingPlan = false;

/** The catalogue's default free plan, or null when it offers none. */
export async function resolveDefaultPlan(): Promise<Plan | null> {
  const plans = await GetModel(PlanModel).findActiveNotDeleted();
  const plan = selectDefaultPlan(plans, getDefaultPlanSlug());
  if (plan) hasWarnedMissingPlan = false;
  return plan;
}

function logMissingDefaultPlan(): void {
  if (hasWarnedMissingPlan) return;
  hasWarnedMissingPlan = true;
  Logging.Warn(
    `${LOG_PREFIX} the catalogue has no active free plan: workspaces without a subscription stay plan-less until one is published`,
  );
}

async function insertDefaultSubscription(
  tenantId: string,
  plan: Plan,
): Promise<boolean> {
  const model = GetModel(TenantSubscriptionModel, tenantId);
  if (await model.findOne()) return false;
  const now = new Date();
  await model.insert([
    {
      _id: tenantId,
      planId: plan._id,
      status: ACTIVE_STATUS,
      isComplimentary: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeCheckoutSessionId: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return true;
}

/**
 * Attaches the default free plan to a workspace that has no subscription at
 * all. A workspace holding any subscription row — paid, pending checkout,
 * suspended — is left untouched, so calling this again is a no-op.
 *
 * @param tenantId Workspace to cover
 * @param plan Default plan already resolved by the caller; resolved here when
 *   omitted
 * @returns Whether a subscription was created
 */
export async function ensureDefaultSubscription(
  tenantId: string,
  plan?: Plan | null,
): Promise<boolean> {
  const defaultPlan = plan === undefined ? await resolveDefaultPlan() : plan;
  if (!defaultPlan) {
    logMissingDefaultPlan();
    return false;
  }
  const isAttached = await runTenantLifecycleOperation(tenantId, () =>
    insertDefaultSubscription(tenantId, defaultPlan),
  );
  if (isAttached) await recomputeTenantBillingState(tenantId);
  return isAttached;
}

async function attachToTenant(tenantId: string, plan: Plan): Promise<boolean> {
  try {
    return await ensureDefaultSubscription(tenantId, plan);
  } catch (error) {
    // One workspace mid-deletion must not keep every other one plan-less.
    Logging.Error(`${LOG_PREFIX} could not cover workspace ${tenantId}`, error);
    return false;
  }
}

/**
 * Covers every workspace created before the default plan existed — the
 * platform's own default tenant included. Idempotent: run at startup and on
 * the billing-state cron, so a catalogue published after boot is picked up.
 *
 * @returns Number of workspaces that received the default plan
 */
export async function backfillDefaultSubscriptions(): Promise<number> {
  const plan = await resolveDefaultPlan();
  if (!plan) {
    logMissingDefaultPlan();
    return 0;
  }
  const tenants = await GetModel(TenantModel).table.pluck("_id").run();
  let attachedCount = 0;
  for (const tenant of tenants) {
    if (tenant._id && (await attachToTenant(tenant._id, plan))) {
      attachedCount++;
    }
  }
  if (attachedCount > 0) {
    Logging.Info(
      `${LOG_PREFIX} attached plan "${plan.slug}" to ${attachedCount} workspace(s)`,
    );
  }
  return attachedCount;
}
