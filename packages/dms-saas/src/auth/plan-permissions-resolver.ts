import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  type PermissionsResolverContext,
  RegisterPermissionsResolver,
} from "@antelopejs/interface-dms/permissions-resolver";
import { PlanModel, TenantSubscriptionModel } from "../db";

const RESOLVER_ID = "dms-saas.plan-intersection";
const RESOLVER_ORDER = 100;
const ALL_PERMISSIONS = "*";

// Blocking subscription statuses are NOT handled here — that
// is a tenant-level access denial enforced by the subscription access gate
// (see subscription-access-gate.ts), which also covers surfaces a permission
// set cannot express (defaultGranted permissions, membership-only guards).
async function intersectWithPlan(
  userId: string,
  tenantId: string,
  current: Set<string>,
  context: PermissionsResolverContext,
): Promise<Set<string>> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const planModel = GetModel(PlanModel);

  const subscription = await tenantSubscriptionModel.findOne();
  if (!subscription?.planId) return current;
  const plan = await planModel.get(subscription.planId);
  if (!plan) return current;

  const resolved = await planModel.resolveInheritance(plan);
  const allowed = new Set(resolved.permissions);
  // A role preview shapes the set of an ordinary member holding that role:
  // the owner grant would show the plan instead of the role.
  const preview = context.preview;
  if (!preview && !current.has(ALL_PERMISSIONS)) {
    const member = await GetModel(TenantMemberModel, tenantId).getByUser(
      userId,
    );
    if (member?.isTenantOwner) {
      allowed.delete(ALL_PERMISSIONS);
      return allowed;
    }
  }
  const keepsWildcard =
    !preview || preview.rolePermissions.has(ALL_PERMISSIONS);
  const result = new Set<string>();
  for (const permission of current) {
    const isKept =
      permission === ALL_PERMISSIONS ? keepsWildcard : allowed.has(permission);
    if (isKept) {
      result.add(permission);
    }
  }
  return result;
}

/** Grant tenant owners their plan's permissions and cap other members' grants. */
export function registerPlanPermissionsResolver(): void {
  RegisterPermissionsResolver({
    id: RESOLVER_ID,
    order: RESOLVER_ORDER,
    resolver: intersectWithPlan,
  });
}
