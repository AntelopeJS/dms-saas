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
import { type User } from "@antelopejs/interface-dms/auth/db";
import {
  type Plan,
  PlanModel,
  TenantSubscriptionModel,
  PLAN_UNLIMITED,
} from "../../db";
import { getSeatUsage, type SeatUsage } from "../../plans";
import {
  type WorkspaceOwnerContact,
  listWorkspaceOwnerContacts,
} from "../../workspaces/owner-contact";

/** A workspace owner a member is told to ask for more seats. */
interface SeatQuotaResult extends SeatUsage {
  maxMembers: number | null;
  planName: string | null;
  /** The first plan on sale with more seats, named in the "full" banner. */
  upgradePlanName: string | null;
  isTenantOwner: boolean;
  owners: WorkspaceOwnerContact[];
}

function offersMoreSeats(candidate: Plan, current: Plan): boolean {
  if (candidate._id === current._id) return false;
  if (candidate.maxMembers === PLAN_UNLIMITED) return true;
  return candidate.maxMembers > current.maxMembers;
}

/**
 * Feeds the seat block injected into the DMS members page. The limit is
 * `null` when no plan is in force or the plan is unlimited, mirroring the
 * enforcement hooks: without a cap there is no seat ceiling to announce.
 * Platform owners holding a membership are listed apart so the customer sees
 * who supports the workspace, and the workspace owners are named so a member
 * knows whom to ask once the seats run out.
 */
export class SaasTenantSeatsController extends Controller(
  "/api/saas/tenant/seats",
) {
  @Model(PlanModel)
  declare planModel: PlanModel;

  private async resolveUpgradePlanName(plan: Plan): Promise<string | null> {
    if (plan.maxMembers === PLAN_UNLIMITED) return null;
    const plans = await this.planModel.findPubliclyVisible();
    const upgrade = plans
      .filter((candidate) => offersMoreSeats(candidate, plan))
      .sort((a, b) => a.order - b.order)[0];
    return upgrade?.name ?? null;
  }

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
    const [usage, subscription, members] = await Promise.all([
      getSeatUsage(tenantId),
      tenantSubscriptionModel.findOne(),
      tenantMemberModel.listAll(),
    ]);
    const plan = subscription?.planId
      ? await this.planModel.get(subscription.planId)
      : undefined;
    const isLimited = !!plan && plan.maxMembers !== PLAN_UNLIMITED;
    return {
      ...usage,
      maxMembers: isLimited ? plan.maxMembers : null,
      planName: plan?.name ?? null,
      upgradePlanName: plan ? await this.resolveUpgradePlanName(plan) : null,
      isTenantOwner: members.some(
        (member) => member.userId === user._id && member.isTenantOwner,
      ),
      owners: await listWorkspaceOwnerContacts(members),
    };
  }
}
