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
import type { TenantSubscription, TenantSubscriptionStatus } from "../../db";
import { TenantSubscriptionModel } from "../../db";
import { fetchScheduledCancellation, getStripeClient } from "../../stripe";
import { liveStripeSubscriptionId } from "../../workspaces/first-payment";
import { isComplimentarySubscription } from "../../workspaces/complimentary";
import {
  findWorkspaceOwnerContact,
  type WorkspaceOwnerContact,
} from "../../workspaces/owner-contact";

const HTTP_BAD_REQUEST = 400;
const RECOVERABLE_STATUSES = new Set<TenantSubscriptionStatus>([
  "past_due",
  "suspended",
]);

interface PortalSessionBody {
  returnUrl: string;
}

interface OwnerBillingDetails {
  paymentMethod: PaymentMethodSummary | null;
  unpaidInvoice: UnpaidInvoiceSummary | null;
  /** When the subscription stops on its own; null while it renews. */
  scheduledCancellationAt: Date | null;
}

interface BillingStatus extends OwnerBillingDetails {
  hasStripeCustomer: boolean;
  status: TenantSubscriptionStatus | null;
  isTenantOwner: boolean;
  /** Who members are told to ask about an unpaid invoice. */
  workspaceOwner: WorkspaceOwnerContact | null;
}

const NO_OWNER_DETAILS: OwnerBillingDetails = {
  paymentMethod: null,
  unpaidInvoice: null,
  scheduledCancellationAt: null,
};

/**
 * A parked downgrade to a free plan is carried by Stripe as a cycle-end
 * cancellation too; only one without a parked plan is the owner leaving. A
 * cancelled workspace has nothing left to schedule.
 */
function readsCancellation(subscription: TenantSubscription): boolean {
  return (
    !!liveStripeSubscriptionId(subscription) && !subscription.pendingPlanId
  );
}

async function loadOwnerDetails(
  tenantId: string,
  subscription: TenantSubscription,
): Promise<OwnerBillingDetails> {
  const needsRecovery = RECOVERABLE_STATUSES.has(subscription.status);
  const [paymentMethod, unpaidInvoice, scheduledCancellationAt] =
    await Promise.all([
      subscription.stripeCustomerId
        ? fetchDefaultPaymentMethod(subscription.stripeCustomerId)
        : null,
      needsRecovery ? buildUnpaidInvoiceSummary(tenantId, subscription) : null,
      readsCancellation(subscription)
        ? fetchScheduledCancellation(subscription.stripeSubscriptionId ?? "")
        : null,
    ]);
  return { paymentMethod, unpaidInvoice, scheduledCancellationAt };
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
   * Read by the suspended screen and by the refund card. The
   * unpaid invoice comes along so the screen can offer settlement without a
   * second call: owner-only, because it carries the payment link, and only when
   * a blocked workspace is one payment away from recovery — a cancelled
   * subscription is not restored by paying, one awaiting its first payment has
   * nothing to settle here, and an unblocked one renders no screen at all, so
   * its reads skip the invoice lookup.
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
   * Billing surface payload for the workspace billing page and the past-due
   * banner. Card details, the unpaid invoice and the scheduled cancellation
   * are owner-only: members see the status and who to ask.
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
    const [subscription, membership, workspaceOwner] = await Promise.all([
      tenantSubscriptionModel.findOne(),
      tenantMemberModel.getByUser(user._id),
      findWorkspaceOwnerContact(tenantId),
    ]);
    const isTenantOwner = !!membership?.isTenantOwner;
    const isComplimentary = isComplimentarySubscription(subscription);
    const base = {
      hasStripeCustomer: !!subscription?.stripeCustomerId && !isComplimentary,
      status: subscription?.status ?? null,
      isTenantOwner,
      workspaceOwner,
    };
    if (!subscription || !isTenantOwner || isComplimentary) {
      return { ...base, ...NO_OWNER_DETAILS };
    }
    return { ...base, ...(await loadOwnerDetails(tenantId, subscription)) };
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
