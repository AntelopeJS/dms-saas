import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { BannerContent } from "@antelopejs/interface-dms/base";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { PlanModel, TenantSubscriptionModel } from "../../db";
import { complimentaryBanner } from "../../workspaces/complimentary-banner";

/**
 * Feeds the complimentary access banner of the billing page. The page stays
 * reachable while an expired gift blocks the workspace, and that is when the
 * banner matters most, so the route bypasses the tenant access gate like the
 * page.
 */
export class SaasTenantComplimentaryBannerController extends Controller(
  "/api/saas/tenant/complimentary-banner",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Get("/")
  async getBanner(
    @Context() ctx: RequestContext,
    @AuthTenantMember({ bypassTenantAccessGate: true }) user: User,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
    @TenantScopedModel(TenantMemberModel)
    tenantMemberModel: TenantMemberModel,
  ): Promise<BannerContent | null> {
    const tenantId = getRequestTenantId(ctx);
    const subscription = await tenantSubscriptionModel.findOne();
    if (!subscription?.isComplimentary) return null;
    const [tenant, plan, membership] = await Promise.all([
      this.tenantModel.get(tenantId),
      subscription.planId ? this.planModel.get(subscription.planId) : null,
      tenantMemberModel.getByUser(user._id),
    ]);
    return complimentaryBanner({
      subscription,
      workspaceName: tenant?.name ?? "",
      planName: plan?.name ?? "",
      isTenantOwner: !!membership?.isTenantOwner,
      now: new Date(),
    });
  }
}
