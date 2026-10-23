import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  PlanChangePolicy,
  PlanChangeValidationRequest,
  PlanChangeIncompatibility,
  TenantPlanConstraints,
  PlanChangeActivation,
} from "@antelopejs/interface-dms-saas/plan-changes";
import { PlanModel, TenantSubscriptionModel } from "../../db";
import {
  countOccupiedSeats,
  fitsWithinSeatLimit,
} from "../../plans/seat-capacity";
import { isGuardedPlanChangeBlocked } from "../../plan-changes/guarded-state";
import {
  BLOCKING_STATUSES,
  PLAN_CHANGE_ACCESS_GATE_ID,
} from "../../auth/subscription-access-gate";

const policies = new Map<string, PlanChangePolicy>();
let requiredPolicyName: string | undefined;

/** Live seat semantics are owned by the existing seat-capacity implementation. */
export function CountOccupiedSeats(tenantId: string): Promise<number> {
  return countOccupiedSeats(tenantId);
}

/** Authorize only this committed Free activation, never another subscription refusal. */
export async function GetPlanChangeActivation(
  tenantId: string,
): Promise<PlanChangeActivation | null> {
  const current = await GetModel(TenantSubscriptionModel, tenantId).findOne();
  const change = current?.guardedPlanChange;
  if (
    !current ||
    !change ||
    change.phase !== "activating" ||
    current.deletionStartedAt ||
    BLOCKING_STATUSES.has(current.status) ||
    current.planId !== change.targetPlanId ||
    current.stripeSubscriptionId
  )
    return null;
  return {
    planChangeOperationId: change.operationId,
    operationId: `${change.operationId}:reactivate`,
    gateId: PLAN_CHANGE_ACCESS_GATE_ID,
  };
}

/** Deployment configuration prevents falling back to legacy billing on unload. */
export function setRequiredPlanChangePolicy(name: string | undefined): void {
  if (name !== undefined && !name.trim())
    throw new Error("Required plan change policy name is empty");
  requiredPolicyName = name;
}

export namespace internal {
  export const RegisterPlanChangePolicy = {
    register: (name: string, policy: PlanChangePolicy): void => {
      policies.set(name, policy);
    },
    unregister: (name: string): void => {
      policies.delete(name);
    },
  };
}

export function hasPlanChangePolicy(): boolean {
  return policies.size > 0 || requiredPolicyName !== undefined;
}

export function getPlanChangePolicy(name?: string): PlanChangePolicy {
  const policy = [...policies.values()][0];
  const requiredName = name ?? requiredPolicyName;
  if (
    policies.size !== 1 ||
    !policy ||
    (requiredName && requiredName !== policy.name)
  ) {
    throw new Error(
      "The required plan change policy is unavailable or ambiguous",
    );
  }
  return policy;
}

/** SaaS owns seat semantics; applications validate the rest of their inventory. */
export async function validateGuardedPlanChange(
  request: PlanChangeValidationRequest,
  policyName?: string,
): Promise<PlanChangeIncompatibility[]> {
  const policy = getPlanChangePolicy(policyName);
  const incompatibilities = await policy.validatePlanChange(request);
  const occupied = await countOccupiedSeats(request.tenantId);
  if (!fitsWithinSeatLimit(request.targetPlan.maxMembers, occupied)) {
    return [
      ...incompatibilities,
      {
        code: "seat_limit",
        message: `The target plan permits ${request.targetPlan.maxMembers} seats; ${occupied} are occupied including invitations`,
        resource: "members",
      },
    ];
  }
  return incompatibilities;
}

/** No acquisition, drain or mutation: callers enter inventory admission first. */
export async function GetTenantPlanConstraints(
  tenantId: string,
): Promise<TenantPlanConstraints> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription)
    return {
      currentPlan: null,
      pendingPlan: null,
      effectiveAt: null,
      planChangeOperationId: null,
      blocked: false,
      admissionBlocked: false,
      incompatibilities: [],
    };
  const plans = GetModel(PlanModel);
  const currentPlan = subscription.planId
    ? ((await plans.get(subscription.planId)) ?? null)
    : null;
  const pendingPlan = subscription.pendingPlanId
    ? ((await plans.get(subscription.pendingPlanId)) ?? null)
    : null;
  const change = subscription.guardedPlanChange;
  return {
    currentPlan,
    pendingPlan,
    planChangeOperationId: change?.operationId ?? null,
    effectiveAt: change
      ? new Date(change.effectiveAt)
      : (subscription.pendingPlanChangeAt ?? null),
    blocked:
      isGuardedPlanChangeBlocked(subscription) ||
      ["pending_payment", "suspended", "cancelled"].includes(
        subscription.status,
      ),
    admissionBlocked:
      change?.phase === "preparing" ||
      change?.phase === "effective" ||
      !!(subscription.pendingPlanId && !pendingPlan),
    incompatibilities: change?.incompatibilities ?? [],
  };
}
