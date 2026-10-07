import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
} from "@antelopejs/interface-dms/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { type Plan, PlanModel, TenantSubscriptionModel } from "../../db";
import { getSeatUsage, type SeatUsage } from "../../plans";

const UNLIMITED_SEATS = -1;

/** A workspace owner a member is told to ask for more seats. */
interface SeatOwnerContact {
  name: string;
  email: string;
}

interface SeatQuotaResult extends SeatUsage {
  maxMembers: number | null;
  planName: string | null;
  /** The first plan on sale with more seats, named in the "full" banner. */
  upgradePlanName: string | null;
  isTenantOwner: boolean;
  owners: SeatOwnerContact[];
}

function offersMoreSeats(candidate: Plan, current: Plan): boolean {
  if (candidate._id === current._id) return false;
  if (candidate.maxMembers === UNLIMITED_SEATS) return true;
  return candidate.maxMembers > current.maxMembers;
}

async function resolveOwnerContacts(
  members: TenantMember[],
): Promise<SeatOwnerContact[]> {
  const owners = members.filter((member) => member.isTenantOwner);
  const users = await Promise.all(
    owners.map((owner) => GetModel(UserModel).get(owner.userId)),
  );
  return users.flatMap((user) =>
    user ? [{ name: user.name || user.email, email: user.email }] : [],
  );
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
    if (plan.maxMembers === UNLIMITED_SEATS) return null;
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
    const isLimited = !!plan && plan.maxMembers !== UNLIMITED_SEATS;
    return {
      ...usage,
      maxMembers: isLimited ? plan.maxMembers : null,
      planName: plan?.name ?? null,
      upgradePlanName: plan ? await this.resolveUpgradePlanName(plan) : null,
      isTenantOwner: members.some(
        (member) => member.userId === user._id && member.isTenantOwner,
      ),
      owners: await resolveOwnerContacts(members),
    };
  }
}
