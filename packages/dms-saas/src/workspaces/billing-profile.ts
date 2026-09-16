import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import type { TenantBillingInfo } from "../db";
import { TenantBillingInfoModel } from "../db";
import type { CardDetails, WorkspaceBillingProfile } from "./provisioning";

const DEFAULT_CUSTOMER_TYPE = "individual" as const;

function toBillingProfile(
  billingInfo: TenantBillingInfo,
): WorkspaceBillingProfile {
  return {
    customerType: billingInfo.customerType ?? DEFAULT_CUSTOMER_TYPE,
    companyName: billingInfo.companyName ?? undefined,
    vatNumber: billingInfo.vatNumber ?? undefined,
    address: {
      line1: billingInfo.address?.line1 ?? undefined,
      line2: billingInfo.address?.line2 ?? undefined,
      postalCode: billingInfo.address?.postalCode ?? undefined,
      city: billingInfo.address?.city ?? undefined,
      state: billingInfo.address?.state ?? undefined,
      country: billingInfo.address?.country ?? undefined,
    },
  };
}

async function findUsableBillingInfo(
  tenantIds: string[],
): Promise<TenantBillingInfo | null> {
  for (const tenantId of tenantIds) {
    const billingInfo = await GetModel(
      TenantBillingInfoModel,
      tenantId,
    ).findOne();
    if (billingInfo?.address?.country) return billingInfo;
  }
  return null;
}

/**
 * Only reorders around a tenant the user actually belongs to: the request
 * tenant falls back to the default one, which may be none of theirs, and
 * reading a stranger's billing identity would leak it into a new workspace.
 */
export function orderTenantIdsByPreference(
  tenantIds: string[],
  preferredTenantId?: string,
): string[] {
  if (!preferredTenantId || !tenantIds.includes(preferredTenantId)) {
    return tenantIds;
  }
  return [
    preferredTenantId,
    ...tenantIds.filter((id) => id !== preferredTenantId),
  ];
}

/**
 * Self-serve creation never asks for a billing identity again: it reuses the
 * one the user already has (Stripe automatic tax needs a country), and falls
 * back to the address carried by the confirmed card.
 *
 * Owned workspaces only: a plain member of someone else's workspace must never
 * see that company name, VAT number and address copied into theirs.
 */
export async function resolveBillingProfileForNewWorkspace(
  userId: string,
  card: CardDetails,
  preferredTenantId?: string,
): Promise<WorkspaceBillingProfile> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  const orderedTenantIds = orderTenantIdsByPreference(
    memberships
      .filter((membership) => membership.member.isTenantOwner)
      .map((membership) => membership.tenantId),
    preferredTenantId,
  );
  const billingInfo = await findUsableBillingInfo(orderedTenantIds);
  if (billingInfo) return toBillingProfile(billingInfo);
  return {
    customerType: DEFAULT_CUSTOMER_TYPE,
    address: card.billingAddress,
  };
}
