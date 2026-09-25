import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { GetPermissions } from "@antelopejs/interface-dms/permissions";
import { RegisterPermissionsResolver } from "@antelopejs/interface-dms/permissions-resolver";
import { getPlanExemptPermissions } from "../config";
import { PlanModel, TenantSubscriptionModel } from "../db";
import {
  isInPlanScope,
  listRegisteredPermissionIds,
  listScopeGrants,
  type PlanPermissionScope,
} from "./plan-permission-scope";

const RESOLVER_ID = "dms-saas.plan-intersection";
const RESOLVER_ORDER = 100;
const ALL_PERMISSIONS = "*";

async function loadPlanPermissions(tenantId: string): Promise<string[] | null> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription?.planId) return null;
  const planModel = GetModel(PlanModel);
  const plan = await planModel.get(subscription.planId);
  if (!plan) return null;
  const resolved = await planModel.resolveInheritance(plan);
  return resolved.permissions;
}

function exemptScope(): PlanPermissionScope {
  const exempt = getPlanExemptPermissions();
  return {
    subtrees: new Set(exempt.personalPages),
    exact: new Set(exempt.navigation),
  };
}

function withPlan(
  scope: PlanPermissionScope,
  planPermissions: string[],
): PlanPermissionScope {
  return {
    subtrees: new Set([...scope.subtrees, ...planPermissions]),
    exact: scope.exact,
  };
}

/**
 * What a member holds beyond their own role grants: the whole plan for a
 * tenant owner, the pages about themselves for everyone else.
 */
async function memberGrants(
  userId: string,
  tenantId: string,
  planScope: PlanPermissionScope,
): Promise<Set<string>> {
  const member = await GetModel(TenantMemberModel, tenantId).getByUser(userId);
  if (!member) return new Set();
  const registeredIds = listRegisteredPermissionIds(await GetPermissions());
  const scope = member.isTenantOwner ? planScope : exemptScope();
  return listScopeGrants(scope, registeredIds);
}

// Blocking subscription statuses are NOT handled here — that
// is a tenant-level access denial enforced by the subscription access gate
// (see subscription-access-gate.ts), which also covers surfaces a permission
// set cannot express (defaultGranted permissions, membership-only guards).
async function intersectWithPlan(
  userId: string,
  tenantId: string,
  current: Set<string>,
): Promise<Set<string>> {
  const planPermissions = await loadPlanPermissions(tenantId);
  if (!planPermissions) return current;
  const planScope = withPlan(exemptScope(), planPermissions);
  const result = new Set(
    [...current].filter(
      (permission) =>
        permission === ALL_PERMISSIONS || isInPlanScope(permission, planScope),
    ),
  );
  if (result.has(ALL_PERMISSIONS)) return result;
  for (const grant of await memberGrants(userId, tenantId, planScope)) {
    result.add(grant);
  }
  return result;
}

/**
 * Cap every member's grants to their plan, and grant tenant owners the plan
 * itself. A permission the plan lists covers every id nested under it, so a
 * page reaches its components and actions; the pages about the signed-in user
 * and the settings navigation stay out of plan gating (see
 * `planExemptPermissions`).
 */
export function registerPlanPermissionsResolver(): void {
  RegisterPermissionsResolver({
    id: RESOLVER_ID,
    order: RESOLVER_ORDER,
    resolver: intersectWithPlan,
  });
}
