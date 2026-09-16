import {
  Context,
  Controller,
  Get,
  JSONBody,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { isTenantSubscriptionBlocked } from "../../auth";
import {
  buildUnpaidInvoiceRef,
  buildUnpaidInvoiceSummary,
  fetchDefaultPaymentMethod,
  type PaymentMethodSummary,
  type UnpaidInvoiceRef,
  type UnpaidInvoiceSummary,
} from "../../billing-state";
import { isAllowedRedirectUrl } from "../../config";
import type { TenantSubscriptionStatus } from "../../db";
import { TenantSubscriptionModel } from "../../db";
import { getStripeClient } from "../../stripe";
import { isComplimentarySubscription } from "../../workspaces/complimentary";

const HTTP_BAD_REQUEST = 400;
const RECOVERABLE_STATUSES = new Set<TenantSubscriptionStatus>([
  "past_due",
  "suspended",
]);

interface PortalSessionBody {
  returnUrl: string;
}

interface BillingStatus {
  hasStripeCustomer: boolean;
  status: TenantSubscriptionStatus | null;
  isTenantOwner: boolean;
  paymentMethod: PaymentMethodSummary | null;
  unpaidInvoice: UnpaidInvoiceSummary | null;
}

interface WorkspaceAccess {
  blocked: boolean;
  status?: TenantSubscriptionStatus;
  isTenantOwner: boolean;
  unpaidInvoice: UnpaidInvoiceRef | null;
}

// The billing routes bypass the tenant access gate on purpose: they are the
// recovery path a blocked workspace uses to regularize its subscription.
export class SaasBillingPortalController extends Controller(
  "/api/saas/billing",
) {
  /**
   * Read by the global suspension middleware and by the suspended screen. The
   * unpaid invoice comes along so the screen can offer settlement without a
   * second call: owner-only, because it carries the payment link, and only when
   * a blocked workspace is one payment away from recovery — a cancelled
   * subscription is not restored by paying, one awaiting its first payment has
   * nothing to settle here, and an unblocked one renders no screen at all, so
   * the middleware's hot path reads no invoice.
   */
  @Get("/access")
  async getWorkspaceAccess(
    @Context() ctx: RequestContext,
    @AuthTenantMember({ bypassTenantAccessGate: true }) user: User,
    @TenantScopedModel(TenantMemberModel)
    tenantMemberModel: TenantMemberModel,
  ): Promise<WorkspaceAccess> {
    const tenantId = getRequestTenantId(ctx);
    const { blocked, status } = await isTenantSubscriptionBlocked(tenantId);
    const membership = await tenantMemberModel.getByUser(user._id);
    const isTenantOwner = !!membership?.isTenantOwner;
    const isSettleable =
      blocked && !!status && RECOVERABLE_STATUSES.has(status);
    return {
      blocked,
      status,
      isTenantOwner,
      unpaidInvoice:
        isTenantOwner && isSettleable
          ? await buildUnpaidInvoiceRef(tenantId)
          : null,
    };
  }

  /**
   * Billing surface payload for the workspace billing page. Card details and
   * the settlement link are owner-only: members see the status and nothing
   * more.
   */
  @Get("/status")
  async getStatus(
    @Context() ctx: RequestContext,
    @AuthTenantMember({ bypassTenantAccessGate: true }) user: User,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
    @TenantScopedModel(TenantMemberModel)
    tenantMemberModel: TenantMemberModel,
  ): Promise<BillingStatus> {
    const tenantId = getRequestTenantId(ctx);
    const subscription = await tenantSubscriptionModel.findOne();
    const membership = await tenantMemberModel.getByUser(user._id);
    const isTenantOwner = !!membership?.isTenantOwner;
    const base = {
      hasStripeCustomer:
        !!subscription?.stripeCustomerId &&
        !isComplimentarySubscription(subscription),
      status: subscription?.status ?? null,
      isTenantOwner,
    };
    if (
      !subscription ||
      !isTenantOwner ||
      isComplimentarySubscription(subscription)
    ) {
      return { ...base, paymentMethod: null, unpaidInvoice: null };
    }
    const needsRecovery = RECOVERABLE_STATUSES.has(subscription.status);
    const [paymentMethod, unpaidInvoice] = await Promise.all([
      subscription.stripeCustomerId
        ? fetchDefaultPaymentMethod(subscription.stripeCustomerId)
        : null,
      needsRecovery ? buildUnpaidInvoiceSummary(tenantId, subscription) : null,
    ]);
    return { ...base, paymentMethod, unpaidInvoice };
  }

  @Post("/portal-session")
  async createPortalSession(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @JSONBody() body: PortalSessionBody,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ) {
    assert(
      isAllowedRedirectUrl(body.returnUrl),
      HTTP_BAD_REQUEST,
      "saas.errors.billing.invalid_return_url",
    );

    const subscription = await tenantSubscriptionModel.findOne();
    assert(
      subscription?.stripeCustomerId &&
        !isComplimentarySubscription(subscription),
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.no_stripe_customer",
    );

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: body.returnUrl,
    });
    return { url: session.url };
  }
}
