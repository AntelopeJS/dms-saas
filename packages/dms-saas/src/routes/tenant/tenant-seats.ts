import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { Model } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { PlanModel, TenantSubscriptionModel } from "../../db";
import { getSeatUsage } from "../../plans";

interface SeatQuotaResult {
  members: number;
  pendingInvites: number;
  occupied: number;
  maxMembers: number | null;
  isTenantOwner: boolean;
}

/**
 * Feeds the seat-quota banner injected into the DMS members page. The limit is
 * `null` when no plan is in force, mirroring the enforcement hooks: without an
 * active plan there is no seat ceiling to announce.
 */
export class SaasTenantSeatsController extends Controller(
  "/api/saas/tenant/seats",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/")
  async getSeatQuota(
    @Context() ctx: RequestContext,
    @AuthTenantMember() user: User,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
    @TenantScopedModel(TenantMemberModel)
    tenantMemberModel: TenantMemberModel,
  ): Promise<SeatQuotaResult> {
    const tenantId = getRequestTenantId(ctx);
    const [usage, subscription, membership] = await Promise.all([
      getSeatUsage(tenantId),
      tenantSubscriptionModel.findOne(),
      tenantMemberModel.getByUser(user._id),
    ]);
    const plan = subscription?.planId
      ? await this.planModel.get(subscription.planId)
      : null;
    return {
      ...usage,
      maxMembers: plan?.maxMembers ?? null,
      isTenantOwner: !!membership?.isTenantOwner,
    };
  }
}
