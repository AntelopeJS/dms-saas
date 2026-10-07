import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  type LayoutBannerComponentInfo,
  type LayoutBannerContext,
  LayoutBannerVariant,
  RegisterLayoutBanner,
} from "@antelopejs/interface-dms/layout-banners";
import { type BillingState, TenantBillingStateModel } from "../db";

const PAST_DUE_STATE: BillingState = "past_due";
const BANNER_COMPONENT = "DmsSaasPastDueBanner";

/** Who a past-due banner speaks to: the owner pays, a member is told who. */
type PastDueAudience = "owner" | "member";

/** Whether the request comes from an owner of the workspace. */
export async function isWorkspaceOwnerRequest({
  user,
  tenantId,
}: LayoutBannerContext): Promise<boolean> {
  if (!user) return false;
  const membership = await GetModel(TenantMemberModel, tenantId).getByUser(
    user._id,
  );
  return !!membership?.isTenantOwner;
}

/**
 * Whether the workspace has an unpaid invoice to announce. Only `past_due`
 * does: a suspended workspace is already sent to its own screen, and every
 * other state has nothing to settle.
 */
export async function isPastDueBannerVisible(
  context: LayoutBannerContext,
): Promise<boolean> {
  if (!context.user) return false;
  const state = await GetModel(TenantBillingStateModel).findByTenant(
    context.tenantId,
  );
  return !state?.deletedAt && state?.billingState === PAST_DUE_STATE;
}

function visibleTo(audience: PastDueAudience) {
  return async (context: LayoutBannerContext): Promise<boolean> => {
    if (!(await isPastDueBannerVisible(context))) return false;
    const isOwner = await isWorkspaceOwnerRequest(context);
    return isOwner === (audience === "owner");
  };
}

/** The owner's strip: an error, not dismissible, with "Pay invoice". */
export const PAST_DUE_OWNER_BANNER: LayoutBannerComponentInfo = {
  key: "dms-saas:past-due",
  variant: LayoutBannerVariant.ERROR,
  component: BANNER_COMPONENT,
  props: { audience: "owner" },
  visible: visibleTo("owner"),
};

/**
 * A member's strip: a warning naming the owner, since members cannot pay;
 * dismissible for the session.
 */
export const PAST_DUE_MEMBER_BANNER: LayoutBannerComponentInfo = {
  key: "dms-saas:past-due-member",
  variant: LayoutBannerVariant.WARNING,
  dismissible: true,
  component: BANNER_COMPONENT,
  props: { audience: "member" },
  visible: visibleTo("member"),
};

export function registerPastDueBanners(): void {
  RegisterLayoutBanner(PAST_DUE_OWNER_BANNER);
  RegisterLayoutBanner(PAST_DUE_MEMBER_BANNER);
}
