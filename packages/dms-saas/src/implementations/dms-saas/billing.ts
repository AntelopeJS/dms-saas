import { HTTPResult } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { AssertTenantAccess } from "@antelopejs/interface-dms/tenant-access";
import type {
  TenantCustomerBalance,
  TenantCustomerBalanceAbsenceReason,
  TenantCustomerBalanceScope,
} from "@antelopejs/interface-dms-saas/billing";
import { TenantSubscriptionModel } from "../../db";
import { retrieveStripeCustomerBalance } from "../../stripe/customer-balance";
import { isComplimentarySubscription } from "@antelopejs/interface-dms-saas/billing";

const HTTP_FORBIDDEN = 403;
const HTTP_BAD_GATEWAY = 502;
const TENANT_MEMBER_REQUIRED = "Tenant member required";
const PROVIDER_UNAVAILABLE =
  "saas.errors.billing.customer_balance_provider_unavailable";

async function assertAuthorizedTenant(
  scope: TenantCustomerBalanceScope,
): Promise<void> {
  const membership = await GetModel(
    TenantMemberModel,
    scope.tenantId,
  ).getByUser(scope.userId);
  assert(membership, HTTP_FORBIDDEN, TENANT_MEMBER_REQUIRED);
  await AssertTenantAccess(scope.userId, scope.tenantId);
}

function absent(
  reason: TenantCustomerBalanceAbsenceReason,
): TenantCustomerBalance {
  return { status: "absent", reason, balanceMinorUnits: null, currency: null };
}

/** Implements the current-tenant customer balance interface. */
export async function GetTenantCustomerBalance(
  scope: TenantCustomerBalanceScope,
): Promise<TenantCustomerBalance> {
  await assertAuthorizedTenant(scope);
  const subscription = await GetModel(
    TenantSubscriptionModel,
    scope.tenantId,
  ).findOne();
  if (!subscription?.stripeCustomerId) return absent("customer_not_configured");
  if (isComplimentarySubscription(subscription)) return absent("complimentary");
  try {
    const balance = await retrieveStripeCustomerBalance(
      subscription.stripeCustomerId,
    );
    if (balance.status === "deleted") return absent("customer_deleted");
    if (!balance.currency) return absent("currency_unavailable");
    return {
      status: "available",
      balanceMinorUnits: balance.balanceMinorUnits,
      currency: balance.currency.toUpperCase(),
    };
  } catch (error) {
    Logging.Error(
      `[dms-saas:billing] customer balance failed for tenant ${scope.tenantId}`,
      error,
    );
    throw new HTTPResult(HTTP_BAD_GATEWAY, PROVIDER_UNAVAILABLE);
  }
}
