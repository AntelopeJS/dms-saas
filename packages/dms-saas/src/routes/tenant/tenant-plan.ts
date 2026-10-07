import {
  Context,
  Controller,
  Delete,
  Get,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { runTenantLifecycleOperation } from "@antelopejs/interface-dms/tenant-lifecycle";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import { AssertTenantAccess } from "@antelopejs/interface-dms/tenant-access";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  FeatureModel,
  type Plan,
  PlanModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { toPendingPlanChange } from "../../plan-changes";
import {
  buildTenantPlanCatalog,
  ensurePlanStripeRefs,
  isDowngrade,
} from "../../plans";
import { findMissingBillingIdentityFields } from "../../workspaces/billing-identity";
import {
  canRecoverComplimentarySubscription,
  isComplimentaryPlanLocked,
  isComplimentarySubscription,
} from "../../workspaces/complimentary";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";
import { ensureDefaultSubscription } from "../../workspaces/default-plan";

import {
  applyImmediateChange,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_NOT_FOUND,
  PAST_DUE_STATUS,
  UNCHANGED_RESULT_BASE,
  assertSeatLimit,
  type ChangePlanBody,
  type ChangePlanResult,
  type CurrentPlanResult,
  dropPendingChange,
  insertFreeSubscription,
  isPaidPlan,
  loadAndValidateTargetPlan,
  type PlanChangeRequest,
  scheduleDowngrade,
} from "./tenant-plan-ops";
import { startPaidCheckout } from "./tenant-plan-checkout";
import {
  type CancelCheckoutResult,
  CHECKOUT_OPERATION_PARAM,
  cancelPendingCheckout,
  describePendingCheckout,
  type PendingCheckoutResult,
} from "./tenant-plan-checkout-recovery";

/** A paid target without a live Stripe subscription goes through Checkout. */
function startsPaidCheckout(
  newPlan: Plan,
  subscription: TenantSubscription | undefined,
): boolean {
  return isPaidPlan(newPlan) && !subscription?.stripeSubscriptionId;
}

/**
 * Moving to a paid plan issues invoices, which Stripe cannot do without a
 * complete billing identity. The upgrade modal saves it first; this guard
 * keeps a direct API call from reaching Checkout without one.
 */
function assertBillingIdentityComplete(
  billingInfo: TenantBillingInfo | undefined,
): void {
  const missing = findMissingBillingIdentityFields({
    customerType: billingInfo?.customerType,
    companyName: billingInfo?.companyName,
    vatNumber: billingInfo?.vatNumber,
    billingEmail: billingInfo?.billingEmail,
    address: billingInfo?.address ?? undefined,
  });
  assert(
    missing.length === 0,
    HTTP_BAD_REQUEST,
    "saas.errors.billing.identity_incomplete",
  );
}

export class SaasTenantPlanController extends Controller(
  "/api/saas/tenant/plan",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(FeatureModel)
  declare featureModel: FeatureModel;

  private async buildCatalog(current: Plan | null, locale: string) {
    const publicPlans = await this.planModel.findPubliclyVisible();
    const withCurrent =
      current && !publicPlans.some((plan) => plan._id === current._id)
        ? [...publicPlans, current]
        : publicPlans;
    // Offered plans are shown payable only once Stripe holds their price.
    const offered = await Promise.all(
      withCurrent.map((plan) => ensurePlanStripeRefs(plan, this.planModel)),
    );
    return buildTenantPlanCatalog(
      this.planModel,
      this.featureModel,
      offered,
      locale,
    );
  }

  /**
   * "No plan" is not a state a workspace can be shown in: one that slipped
   * through every creation path gets the default plan on first read rather
   * than waiting for the next backfill.
   */
  private async loadSubscription(
    tenantId: string,
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<TenantSubscription | undefined> {
    const subscription = await tenantSubscriptionModel.findOne();
    if (subscription || !(await ensureDefaultSubscription(tenantId))) {
      return subscription;
    }
    return tenantSubscriptionModel.findOne();
  }

  /**
   * The plan card is the first block of the billing page, which stays reachable
   * while the access gate blocks the workspace. Reading the plan is part of the
   * recovery path; changing it is not, so the mutations below stay gated — a
   * suspended workspace must not walk away from an unpaid invoice by
   * downgrading to a cheaper plan.
   */
  @Get("/")
  async getCurrentPlan(
    @AuthTenantMember({ bypassTenantAccessGate: true }) _user: User,
    @Context() ctx: any,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
    @Parameter(CONTENT_LANGUAGE_HEADER, "header") language: unknown,
  ): Promise<CurrentPlanResult> {
    const tenantId = getRequestTenantId(ctx);
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    const subscription = await this.loadSubscription(
      tenantId,
      tenantSubscriptionModel,
    );
    const current = subscription?.planId
      ? ((await this.planModel.get(subscription.planId)) ?? null)
      : null;
    const pending = subscription?.pendingPlanId
      ? await this.planModel.get(subscription.pendingPlanId)
      : null;
    const catalog = await this.buildCatalog(current, requestLocale(language));
    return {
      current,
      available: catalog.plans,
      features: catalog.features,
      status: subscription?.status ?? null,
      freeUntil: subscription?.freeUntil ?? null,
      isComplimentary: isComplimentarySubscription(subscription),
      isPlanChangeLocked: isComplimentaryPlanLocked(subscription),
      canRecoverComplimentary:
        canRecoverComplimentarySubscription(subscription),
      paidUsageStartedAt: subscription?.paidUsageStartedAt ?? null,
      paidUsagePeriods: subscription?.paidUsagePeriods ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      pendingPlan: toPendingPlanChange(subscription, pending),
    };
  }

  @Delete("/pending")
  async cancelPendingChange(
    @AuthTenantOwner() user: User,
    @Context() ctx: any,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<ChangePlanResult> {
    const tenantId = getRequestTenantId(ctx);
    const subscription = await tenantSubscriptionModel.findOne();
    this.assertPlanChangeAllowed(subscription, user);
    assert(
      subscription?.pendingPlanId,
      HTTP_BAD_REQUEST,
      "saas.errors.plan.no_pending_change",
    );
    return dropPendingChange(tenantId, subscription);
  }

  /**
   * The checkout the workspace is waiting on, so the owner can resume paying
   * it rather than start another. Reachable while the access gate blocks the
   * workspace, like the checkout it describes.
   */
  @Get("/checkout")
  async getPendingCheckout(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<PendingCheckoutResult> {
    return describePendingCheckout(await tenantSubscriptionModel.findOne());
  }

  /**
   * The owner giving up on the pending checkout: from the billing page, or on
   * the way back from Stripe's cancel link, which names the checkout it
   * belongs to so that a stale link releases nothing.
   */
  @Delete("/checkout")
  async cancelCheckout(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @Parameter(CHECKOUT_OPERATION_PARAM, "query") operationId: unknown,
    @Context() ctx: any,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<CancelCheckoutResult> {
    const tenantId = getRequestTenantId(ctx);
    return runTenantLifecycleOperation(tenantId, async () =>
      cancelPendingCheckout(
        await tenantSubscriptionModel.findOne(),
        tenantSubscriptionModel,
        typeof operationId === "string" && operationId ? operationId : null,
      ),
    );
  }

  @Put("/")
  async changePlan(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) user: User,
    @JSONBody() body: ChangePlanBody,
    @Context() ctx: any,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
    @TenantScopedModel(TenantBillingInfoModel)
    tenantBillingInfoModel: TenantBillingInfoModel,
  ): Promise<ChangePlanResult> {
    const tenantId = getRequestTenantId(ctx);
    const tenant = await this.tenantModel.get(tenantId);
    assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
    const subscription = await tenantSubscriptionModel.findOne();
    this.assertPlanChangeAllowed(subscription, user);
    const isRecovery = canRecoverComplimentarySubscription(subscription);
    if (!isRecovery) await AssertTenantAccess(user._id, tenantId);
    const billingInfo = await tenantBillingInfoModel.findOne();
    const newPlan = await loadAndValidateTargetPlan(
      this.planModel,
      body.planId,
      billingInfo?.customerType,
    );
    await assertSeatLimit(tenantId, newPlan);
    assert(
      !isRecovery || isPaidPlan(newPlan),
      HTTP_CONFLICT,
      "saas.errors.plan.paid_recovery_required",
    );
    if (subscription?.planId === body.planId && !isRecovery) {
      return this.resolveSamePlanRequest(tenantId, subscription);
    }
    if (!isRecovery && startsPaidCheckout(newPlan, subscription)) {
      assertBillingIdentityComplete(billingInfo);
    }

    return this.routePlanChange({
      tenantId,
      user,
      newPlan,
      body,
      subscription,
      tenantSubscriptionModel,
    });
  }

  private assertPlanChangeAllowed(
    subscription: TenantSubscription | undefined,
    user: User,
  ): void {
    assert(
      user.owner || !isComplimentaryPlanLocked(subscription),
      HTTP_CONFLICT,
      "saas.errors.plan.complimentary_locked",
    );
  }

  /**
   * Re-selecting the plan already in force while a downgrade is parked is the
   * user cancelling that downgrade; otherwise there is nothing to do.
   */
  private async resolveSamePlanRequest(
    tenantId: string,
    subscription: TenantSubscription,
  ): Promise<ChangePlanResult> {
    if (subscription.pendingPlanId) {
      return dropPendingChange(tenantId, subscription);
    }
    return { ...UNCHANGED_RESULT_BASE, planId: subscription.planId ?? "" };
  }

  private async routePlanChange(
    request: PlanChangeRequest,
  ): Promise<ChangePlanResult> {
    const { tenantId, user, newPlan, subscription, tenantSubscriptionModel } =
      request;

    if (startsPaidCheckout(newPlan, subscription)) {
      return startPaidCheckout(request);
    }
    if (!subscription) {
      return insertFreeSubscription(
        user,
        newPlan._id,
        tenantId,
        tenantSubscriptionModel,
      );
    }
    return this.changeExistingSubscription(request, subscription);
  }

  private async changeExistingSubscription(
    request: PlanChangeRequest,
    subscription: TenantSubscription,
  ): Promise<ChangePlanResult> {
    const { tenantId, newPlan, tenantSubscriptionModel } = request;
    const currentPlan = subscription.planId
      ? ((await this.planModel.get(subscription.planId)) ?? null)
      : null;

    // Leaving a live Stripe subscription for a cheaper — or free — plan always
    // waits for the cycle the customer already paid for to run out.
    const isDeferred =
      !!subscription.stripeSubscriptionId &&
      (!isPaidPlan(newPlan) || isDowngrade(currentPlan, newPlan));
    if (isDeferred) {
      // The access gate only blocks suspended workspaces; past_due is still a
      // dunning episode over an unpaid invoice, and parking a downgrade — a
      // free target especially — would let the workspace land past it when
      // Stripe cancels at cycle end. Same rule as the suspended state: settle
      // first, downgrade after.
      assert(
        subscription.status !== PAST_DUE_STATUS,
        HTTP_CONFLICT,
        "saas.errors.plan.unpaid_invoice_blocks_downgrade",
      );
      return scheduleDowngrade(tenantId, subscription, newPlan);
    }
    return applyImmediateChange(
      tenantId,
      subscription,
      newPlan,
      tenantSubscriptionModel,
    );
  }
}
