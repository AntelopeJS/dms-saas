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
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
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
  countSeatsToCompare,
  ensurePlanStripeRefs,
  getSeatUsage,
  isDowngrade,
  type TenantPlanView,
} from "../../plans";
import { findMissingBillingIdentityFields } from "../../workspaces/billing-identity";
import {
  canResubscribe,
  canStartFirstPaidSubscription,
} from "../../workspaces/first-payment";
import {
  isComplimentaryPlanLocked,
  isComplimentarySubscription,
} from "../../workspaces/complimentary";
import {
  CONTENT_LANGUAGE_HEADER,
  requestLocale,
} from "../../utils/content-language";
import { ensureDefaultSubscription } from "../../workspaces/default-plan";

import {
  applyOwnerUpgrade,
  assertPlanAudience,
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
  loadSellablePlan,
  type OfferedPlanView,
  type PlanChangeRequest,
  scheduleDowngrade,
  startsPaidCheckout,
} from "./tenant-plan-ops";
import {
  type PlanChangePreview,
  previewPlanChange,
} from "./tenant-plan-preview";
import {
  isTrialOfferedOnChange,
  startPaidCheckout,
} from "./tenant-plan-checkout";
import {
  type CancelCheckoutResult,
  CHECKOUT_OPERATION_PARAM,
  cancelPendingCheckout,
  describePendingCheckout,
  type PendingCheckoutResult,
} from "./tenant-plan-checkout-recovery";
import { resubscribeOnFreePlan } from "./tenant-plan-resubscription";

const PRORATION_DATE_MAX_AGE_SECONDS = 3600;
const MS_PER_SECOND = 1000;

/**
 * The proration date of the preview the owner reviewed, kept only while
 * recent: an old one would bill a difference that no longer matches.
 */
export function acceptedProrationDate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  const ageSeconds = Date.now() / MS_PER_SECOND - value;
  const isRecent =
    ageSeconds >= 0 && ageSeconds <= PRORATION_DATE_MAX_AGE_SECONDS;
  return isRecent ? value : undefined;
}

function asQueryString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** Who the comparison is read for: the trial a plan offers depends on it. */
interface CatalogReader {
  subscription: TenantSubscription | undefined;
  email: string;
}

/** The customer-facing facts of a plan the comparison needs beside its features. */
async function toOfferedPlanView(
  view: TenantPlanView,
  plans: Plan[],
  reader: CatalogReader,
): Promise<OfferedPlanView> {
  const plan = plans.find((candidate) => candidate._id === view._id);
  const isTrialOffered =
    !!plan &&
    (await isTrialOfferedOnChange(plan, reader.subscription, reader.email));
  return {
    ...view,
    description: plan?.description ?? "",
    billingMode: plan?.billingMode ?? "flat",
    maxMembers: plan?.maxMembers ?? 0,
    trialDays: plan?.trialDays ?? 0,
    isTrialOffered,
  };
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

  private async buildCatalog(
    current: Plan | null,
    locale: string,
    reader: CatalogReader,
  ) {
    const publicPlans = await this.planModel.findPubliclyVisible();
    const withCurrent =
      current && !publicPlans.some((plan) => plan._id === current._id)
        ? [...publicPlans, current]
        : publicPlans;
    // Offered plans are shown payable only once Stripe holds their price.
    const offered = await Promise.all(
      withCurrent.map((plan) => ensurePlanStripeRefs(plan, this.planModel)),
    );
    const catalog = await buildTenantPlanCatalog(
      this.planModel,
      this.featureModel,
      offered,
      locale,
    );
    return {
      features: catalog.features,
      plans: await Promise.all(
        catalog.plans.map((view) => toOfferedPlanView(view, offered, reader)),
      ),
    };
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
    @AuthTenantMember({ bypassTenantAccessGate: true }) user: User,
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
    const [catalog, seatUsage] = await Promise.all([
      this.buildCatalog(current, requestLocale(language), {
        subscription,
        email: user.email,
      }),
      getSeatUsage(tenantId),
    ]);
    return {
      current,
      seats: {
        members: seatUsage.members,
        pendingInvites: seatUsage.pendingInvites,
        occupied: seatUsage.occupied,
      },
      available: catalog.plans,
      features: catalog.features,
      status: subscription?.status ?? null,
      freeUntil: subscription?.freeUntil ?? null,
      isComplimentary: isComplimentarySubscription(subscription),
      isPlanChangeLocked: isComplimentaryPlanLocked(subscription),
      canRecoverComplimentary: canStartFirstPaidSubscription(subscription),
      canResubscribe: canResubscribe(subscription),
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

  /**
   * What changing to `planId` would cost, priced by Stripe without changing
   * anything: the review step of the plan change dialog. Same guards as the
   * change itself, except the customer type, which the upgrade dialog may
   * still be filling in.
   */
  @Get("/preview")
  async previewChange(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) user: User,
    @Parameter("planId", "query") planId: unknown,
    @Parameter("country", "query") country: unknown,
    @Context() ctx: any,
    @TenantScopedModel(TenantBillingInfoModel)
    tenantBillingInfoModel: TenantBillingInfoModel,
  ): Promise<PlanChangePreview> {
    const tenantId = getRequestTenantId(ctx);
    const subscription = await GetModel(
      TenantSubscriptionModel,
      tenantId,
    ).findOne();
    this.assertPlanChangeAllowed(subscription, user);
    const targetPlanId = asQueryString(planId);
    assert(targetPlanId, HTTP_BAD_REQUEST, "saas.errors.plan.invalid");
    assert(
      subscription?.planId !== targetPlanId ||
        canStartFirstPaidSubscription(subscription) ||
        canResubscribe(subscription),
      HTTP_CONFLICT,
      "saas.errors.plan.already_current",
    );
    const billingInfo = await tenantBillingInfoModel.findOne();
    const target = await loadSellablePlan(this.planModel, targetPlanId);
    if (billingInfo?.customerType) {
      assertPlanAudience(target, billingInfo.customerType);
    }
    await assertSeatLimit(tenantId, target);
    const currentPlan = subscription?.planId
      ? ((await this.planModel.get(subscription.planId)) ?? null)
      : null;
    return previewPlanChange({
      tenantId,
      subscription,
      currentPlan,
      target,
      billingInfo,
      ownerEmail: user.email,
      country: asQueryString(country),
    });
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
    const isRecovery = canStartFirstPaidSubscription(subscription);
    // A cancelled workspace is blocked too; choosing a plan is how its owner
    // brings it back, on any plan, the one it was cancelled on included.
    const choosesAnew = isRecovery || canResubscribe(subscription);
    if (!choosesAnew) await AssertTenantAccess(user._id, tenantId);
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
    if (subscription?.planId === body.planId && !choosesAnew) {
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
    if (canResubscribe(subscription)) {
      return resubscribeOnFreePlan(request);
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
      (!isPaidPlan(newPlan) ||
        isDowngrade(
          currentPlan,
          newPlan,
          await countSeatsToCompare(tenantId, [currentPlan, newPlan]),
        ));
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
    return applyOwnerUpgrade(
      tenantId,
      subscription,
      newPlan,
      tenantSubscriptionModel,
      acceptedProrationDate(request.body.prorationDate),
    );
  }
}
