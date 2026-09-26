import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type LayoutBannerComponentInfo,
  type LayoutBannerContext,
  LayoutBannerVariant,
  RegisterLayoutBanner,
} from "@antelopejs/interface-dms/layout-banners";
import { type BillingState, TenantBillingStateModel } from "../db";

const PAST_DUE_STATE: BillingState = "past_due";

/**
 * Whether the workspace-wide past-due banner shows for a request. Only
 * `past_due` does: a suspended workspace is already sent to its own screen,
 * and every other state has nothing to settle.
 */
export async function isPastDueBannerVisible({
  user,
  tenantId,
}: LayoutBannerContext): Promise<boolean> {
  if (!user) return false;
  const state = await GetModel(TenantBillingStateModel).findByTenant(tenantId);
  return !state?.deletedAt && state?.billingState === PAST_DUE_STATE;
}

export const PAST_DUE_BANNER: LayoutBannerComponentInfo = {
  key: "dms-saas:past-due",
  variant: LayoutBannerVariant.ERROR,
  component: "DmsSaasPastDueBanner",
  visible: isPastDueBannerVisible,
};

export function registerPastDueBanner(): void {
  RegisterLayoutBanner(PAST_DUE_BANNER);
}
