import { Controller, Get, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type Stripe from "stripe";
import type { BillingSettings, TenantSubscription } from "../../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  TenantSubscriptionModel,
} from "../../db";
import {
  computeUnusedPortionCents,
  getStripeClient,
  nowInStripeSeconds,
} from "../../stripe";
import { MS_PER_DAY } from "../../utils/time";

const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const MS_PER_SECOND = 1000;
const STRIPE_INVOICES_FETCH_LIMIT = 100;
const FULL_REFUND_MODE = "full";

const REASON_NOT_ENABLED = "not_enabled";
const REASON_NO_SUBSCRIPTION = "no_subscription";
const REASON_ALREADY_PROCESSED = "already_processed";
const REASON_NO_INVOICE = "no_invoice";
const REASON_WINDOW_EXPIRED = "window_expired";

interface RefundErrorMapping {
  code: number;
  message: string;
}

const REASON_TO_ERROR: Record<string, RefundErrorMapping> = {
  [REASON_NOT_ENABLED]: {
    code: HTTP_FORBIDDEN,
    message: "saas.errors.refund.not_enabled",
  },
  [REASON_NO_SUBSCRIPTION]: {
    code: HTTP_BAD_REQUEST,
    message: "saas.errors.workspace.no_active_subscription",
  },
  [REASON_ALREADY_PROCESSED]: {
    code: HTTP_CONFLICT,
    message: "saas.errors.refund.already_processed",
  },
  [REASON_NO_INVOICE]: {
    code: HTTP_NOT_FOUND,
    message: "saas.errors.invoice.no_paid_found",
  },
  [REASON_WINDOW_EXPIRED]: {
    code: HTTP_FORBIDDEN,
    message: "saas.errors.refund.window_expired",
  },
};

interface EligibleInvoice {
  id: string;
  amountPaid: number;
  created: number;
  periodStart: number | null;
  periodEnd: number | null;
  currency: string | null;
}

interface RefundEligibility {
  eligible: boolean;
  reason: string | null;
  windowDays: number;
  mode: string | null;
  invoice: EligibleInvoice | null;
}

interface RefundEligibilityResponse {
  eligible: boolean;
  reason: string | null;
  windowDays: number;
  mode: string | null;
  refundAmount: number | null;
  currency: string | null;
}

async function getFirstPaidInvoice(
  stripeCustomerId: string,
): Promise<Stripe.Invoice | null> {
  const stripe = getStripeClient();
  // Stripe returns invoices newest-first. Page through every paid invoice and
  // keep the oldest one, so customers with more than one page of invoices
  // still get their true first invoice instead of the oldest of the last 100.
  let oldest: Stripe.Invoice | null = null;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.invoices.list({
      customer: stripeCustomerId,
      status: "paid",
      limit: STRIPE_INVOICES_FETCH_LIMIT,
      starting_after: startingAfter,
    });
    for (const invoice of page.data) {
      if (!oldest || (invoice.created ?? 0) < (oldest.created ?? 0)) {
        oldest = invoice;
      }
    }
    const lastId = page.data[page.data.length - 1]?.id;
    if (!page.has_more || !lastId) break;
    startingAfter = lastId;
  }
  return oldest;
}

function toEligibleInvoice(invoice: Stripe.Invoice): EligibleInvoice {
  const line = invoice.lines?.data?.[0];
  return {
    id: invoice.id as string,
    amountPaid: invoice.amount_paid,
    created: invoice.created ?? 0,
    periodStart: line?.period?.start ?? null,
    periodEnd: line?.period?.end ?? null,
    currency: invoice.currency ?? null,
  };
}

function isWithinWindow(invoiceCreated: number, windowDays: number): boolean {
  const cutoff = Date.now() - windowDays * MS_PER_DAY;
  return invoiceCreated * MS_PER_SECOND >= cutoff;
}

function computeRefundAmount(invoice: EligibleInvoice, mode: string): number {
  if (mode === FULL_REFUND_MODE) return invoice.amountPaid;
  return computeUnusedPortionCents(
    invoice.amountPaid,
    invoice.periodStart,
    invoice.periodEnd,
    nowInStripeSeconds(),
  );
}

async function resolveRefundEligibility(
  settings: BillingSettings | undefined,
  subscription: TenantSubscription | undefined,
): Promise<RefundEligibility> {
  const windowDays = settings?.moneyBackGuaranteeWindowDays ?? 0;
  const mode = settings?.moneyBackGuaranteeMode ?? null;
  const base = { windowDays, mode, invoice: null };
  if (!settings?.moneyBackGuaranteeEnabled) {
    return { eligible: false, reason: REASON_NOT_ENABLED, ...base };
  }
  if (!subscription?.stripeCustomerId || !subscription.stripeSubscriptionId) {
    return { eligible: false, reason: REASON_NO_SUBSCRIPTION, ...base };
  }
  if (subscription.refundRequestedAt) {
    return { eligible: false, reason: REASON_ALREADY_PROCESSED, ...base };
  }
  const stripeInvoice = await getFirstPaidInvoice(
    subscription.stripeCustomerId,
  );
  if (!stripeInvoice?.id || !stripeInvoice.created) {
    return { eligible: false, reason: REASON_NO_INVOICE, ...base };
  }
  const invoice = toEligibleInvoice(stripeInvoice);
  if (!isWithinWindow(invoice.created, windowDays)) {
    return { eligible: false, reason: REASON_WINDOW_EXPIRED, ...base };
  }
  return { eligible: true, reason: null, windowDays, mode, invoice };
}

async function issueRefundAndCancel(
  subscriptionId: string,
  stripeSubscriptionId: string,
  invoiceId: string,
  refundAmount: number,
): Promise<void> {
  const stripe = getStripeClient();
  // Cancel first so the irreversible action (returning money) happens last. If
  // the cancel fails, no money has left yet; the caller releases the refund
  // claim so the request can be retried. Both calls use deterministic
  // idempotency keys, so a retry never double-cancels or double-refunds.
  await stripe.subscriptions.cancel(stripeSubscriptionId, {
    idempotencyKey: `cancel-self-refund:${subscriptionId}`,
  });
  await stripe.creditNotes.create(
    {
      invoice: invoiceId,
      amount: refundAmount,
      refund_amount: refundAmount,
      memo: "Money-back guarantee self-service refund",
      reason: "order_change",
    },
    { idempotencyKey: `refund-self:${subscriptionId}` },
  );
}

export class SaasBillingSelfRefundController extends Controller(
  "/api/saas/billing",
) {
  @Get("/refund-eligibility")
  async getRefundEligibility(
    @AuthTenantOwner() _user: User,
    @Model(BillingSettingsModel) billingSettingsModel: BillingSettingsModel,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<RefundEligibilityResponse> {
    const settings = await billingSettingsModel.get(
      BILLING_SETTINGS_SINGLETON_ID,
    );
    const subscription = await tenantSubscriptionModel.findOne();
    const eligibility = await resolveRefundEligibility(settings, subscription);
    const refundAmount = eligibility.invoice
      ? computeRefundAmount(
          eligibility.invoice,
          eligibility.mode ?? FULL_REFUND_MODE,
        )
      : null;
    return {
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      windowDays: eligibility.windowDays,
      mode: eligibility.mode,
      refundAmount,
      currency: eligibility.invoice?.currency ?? null,
    };
  }

  @Post("/refund-self")
  async requestSelfRefund(
    @AuthTenantOwner() _user: User,
    @Model(BillingSettingsModel) billingSettingsModel: BillingSettingsModel,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ) {
    const settings = await billingSettingsModel.get(
      BILLING_SETTINGS_SINGLETON_ID,
    );
    const subscription = await tenantSubscriptionModel.findOne();
    const eligibility = await resolveRefundEligibility(settings, subscription);
    const error = eligibility.eligible
      ? null
      : REASON_TO_ERROR[eligibility.reason ?? ""];
    assert(
      eligibility.eligible,
      error?.code ?? HTTP_BAD_REQUEST,
      error?.message ?? "saas.errors.refund.not_eligible",
    );
    assert(
      eligibility.invoice && subscription?.stripeSubscriptionId,
      HTTP_BAD_REQUEST,
      "saas.errors.workspace.no_active_subscription",
    );

    const claimed = await tenantSubscriptionModel.claimSelfRefund(
      subscription._id,
    );
    assert(claimed, HTTP_CONFLICT, "saas.errors.refund.already_processed");

    const refundAmount = computeRefundAmount(
      eligibility.invoice,
      eligibility.mode ?? FULL_REFUND_MODE,
    );
    try {
      await issueRefundAndCancel(
        subscription._id,
        subscription.stripeSubscriptionId,
        eligibility.invoice.id,
        refundAmount,
      );
    } catch (error) {
      // Release the claim so a partial failure (e.g. cancel succeeded but the
      // credit note call threw) can be retried. The deterministic idempotency
      // keys make the retry safe against double-cancel/double-refund.
      await tenantSubscriptionModel
        .releaseSelfRefund(subscription._id)
        .catch(() => {});
      throw error;
    }
    return { refunded: refundAmount };
  }
}
