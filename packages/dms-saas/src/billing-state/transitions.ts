import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { isDowngrade } from "@antelopejs/interface-dms-saas/plans";
import { emitOriginatedAutomationEvent } from "../automation/events";
import {
  type BillingState,
  type Plan,
  PlanModel,
  type TenantBillingState,
  type WorkspaceDirectoryFields,
} from "../db";

/** A publication that replaced `previous` with `billingState` and `directory`. */
export interface BillingPublication {
  tenantId: string;
  previous: TenantBillingState;
  billingState: BillingState;
  directory: WorkspaceDirectoryFields;
}

async function loadPlan(planId: string | null): Promise<Plan | undefined> {
  return planId ? GetModel(PlanModel).get(planId) : undefined;
}

async function planDirection(
  publication: BillingPublication,
): Promise<"upgrade" | "downgrade"> {
  const [from, to] = await Promise.all([
    loadPlan(publication.previous.planId),
    loadPlan(publication.directory.planId),
  ]);
  if (!from) return "upgrade";
  if (!to) return "downgrade";
  return isDowngrade(from, to, publication.directory.seats)
    ? "downgrade"
    : "upgrade";
}

function emitStateChange(publication: BillingPublication, at: string): void {
  const { tenantId, previous, billingState, directory } = publication;
  emitOriginatedAutomationEvent("saas.billing-state-changed", {
    tenantId,
    deliveryId: `billing-state:${tenantId}:${previous.revision}`,
    at,
    fromState: previous.billingState,
    toState: billingState,
    planId: directory.planId,
    planName: directory.planName,
    mrrMinor: directory.mrrMinor,
    previousMrrMinor: directory.previousMrrMinor,
    currency: directory.currency,
  });
}

async function emitPlanChange(
  publication: BillingPublication,
  at: string,
): Promise<void> {
  const { tenantId, previous, billingState, directory } = publication;
  emitOriginatedAutomationEvent("saas.plan-changed", {
    tenantId,
    deliveryId: `plan:${tenantId}:${previous.revision}`,
    at,
    fromPlanId: previous.planId,
    toPlanId: directory.planId,
    fromPlanName: previous.planName,
    toPlanName: directory.planName,
    direction: await planDirection(publication),
    billingState,
  });
}

/**
 * Hands automation the transitions one publication made. The publication is
 * fenced on the revision it replaced, so exactly one publication can follow
 * a given revision, and that revision identifies the event. A failure here is
 * logged and never fails the publication.
 */
export async function emitBillingTransitions(
  publication: BillingPublication,
): Promise<void> {
  const at = new Date().toISOString();
  try {
    if (publication.previous.billingState !== publication.billingState)
      emitStateChange(publication, at);
    if (publication.previous.planId !== publication.directory.planId)
      await emitPlanChange(publication, at);
  } catch (error) {
    Logging.Error(
      `[dms-saas:billing-state] automation events failed for tenant ${publication.tenantId}`,
      error,
    );
  }
}
