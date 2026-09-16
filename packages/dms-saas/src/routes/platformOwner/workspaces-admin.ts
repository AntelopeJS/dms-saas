import { randomUUID } from "node:crypto";
import {
  Controller,
  Get,
  JSONBody,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { recomputeTenantBillingState } from "../../billing-state";
import {
  type Plan,
  type SubscriptionTransition,
  PlanModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import {
  complimentaryAccessGrantedSubject,
  notifyTenantOwners,
} from "../../notifications";
import { getStripeClient } from "../../stripe";
import { parseFutureDate } from "../../utils";
import { closePaidUsagePeriods } from "../../workspaces/complimentary";

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

const ACTIVE_STATUS: TenantSubscriptionStatus = "active";

const COMP_ICON = "i-ph-gift";
const ANY_AUDIENCE = "any";

const NOTIF_COMP_TITLE =
  "$saas.notifications.payload.complimentary_access_granted.title";
const NOTIF_COMP_DESC =
  "$saas.notifications.payload.complimentary_access_granted.description";

interface AdminWorkspaceState {
  status: TenantSubscriptionStatus | null;
  planId: string | null;
  hasStripeSubscription: boolean;
  freeUntil: Date | null;
  domainTransition: SubscriptionTransition | null;
  deletionStartedAt: Date | null;
}

interface GrantFreeAccessBody {
  planId: string;
  freeUntil?: string | null;
}

async function upsertFreeSubscription(
  tenantId: string,
  planId: string,
  freeUntil: Date | null,
  createdBy: string,
): Promise<void> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const existing = await tenantSubscriptionModel.findOne();
  const operationId = randomUUID();
  if (existing)
    await tenantSubscriptionModel.beginTransition(existing, {
      operationId,
      kind: "change_plan",
      targetPlanId: planId,
      requestedAt: new Date(),
    });
  if (existing?.stripeSubscriptionId) {
    await getStripeClient().subscriptions.cancel(
      existing.stripeSubscriptionId,
      { idempotencyKey: `admin-grant-free:${operationId}` },
    );
  }
  // Clears the subscription/checkout refs and the self-refund claim
  // (refundRequestedAt), which re-arms self-refund eligibility.
  // stripeCustomerId is preserved on update so the existing Stripe customer
  // (and its saved payment methods) is reused when billing resumes instead of
  // orphaning it with a brand-new one.
  const payload = {
    planId,
    status: ACTIVE_STATUS,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    refundRequestedAt: null,
    freeUntil,
    isComplimentary: true,
    paidUsageStartedAt: null,
    paidUsagePeriods: closePaidUsagePeriods(existing, new Date()),
    updatedAt: new Date(),
  };
  if (existing) {
    await tenantSubscriptionModel.completeTransition(
      existing._id,
      operationId,
      payload,
    );
  } else {
    await tenantSubscriptionModel.insert([
      {
        ...payload,
        _id: tenantId,
        stripeCustomerId: null,
        createdBy,
        createdAt: new Date(),
      },
    ]);
  }
  await recomputeTenantBillingState(tenantId);
}

async function assertPlanIsAvailableForTenant(
  plan: Plan,
  tenantId: string,
): Promise<void> {
  assert(
    plan && !plan.isDeleted && plan.isActive,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.invalid",
  );
  const billingInfo = await GetModel(
    TenantBillingInfoModel,
    tenantId,
  ).findOne();
  assert(
    plan.audience === ANY_AUDIENCE ||
      plan.audience === billingInfo?.customerType,
    HTTP_BAD_REQUEST,
    "saas.errors.plan.not_available_for_customer_type",
  );
}

export class SaasWorkspacesAdminController extends Controller(
  "/api/saas/workspaces",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Get("/:tenantId/admin-state")
  async getAdminState(
    @AuthOwnerOnly() _user: User,
    @Parameter("tenantId", "param") tenantId: string,
  ): Promise<AdminWorkspaceState> {
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    const sub = await GetModel(TenantSubscriptionModel, tenantId).findOne();
    return {
      status: sub?.status ?? null,
      planId: sub?.planId ?? null,
      hasStripeSubscription: !!sub?.stripeSubscriptionId,
      freeUntil: sub?.freeUntil ?? null,
      domainTransition: sub?.domainTransition ?? null,
      deletionStartedAt: sub?.deletionStartedAt ?? null,
    };
  }

  @Post("/:tenantId/grant-free-access")
  async grantFreeAccess(
    @AuthOwnerOnly() user: User,
    @Parameter("tenantId", "param") tenantId: string,
    @JSONBody() body: GrantFreeAccessBody,
  ) {
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    const plan = await this.planModel.get(body.planId);
    assert(plan, HTTP_BAD_REQUEST, "saas.errors.plan.invalid");
    await assertPlanIsAvailableForTenant(plan, tenantId);
    const freeUntil = parseFutureDate(
      body.freeUntil,
      "saas.workspaces.admin.create.error.free_until_past",
    );
    await runTenantLifecycleOperation(tenantId, () =>
      upsertFreeSubscription(tenantId, body.planId, freeUntil, user._id),
    );
    await notifyTenantOwners(tenantId, complimentaryAccessGrantedSubject, {
      icon: COMP_ICON,
      title: NOTIF_COMP_TITLE,
      description: NOTIF_COMP_DESC,
    });
    return { tenantId, planId: body.planId, freeUntil };
  }
}
