import { Controller, Get, Post } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type Stripe from "stripe";
import type { BillingSettings, TenantSubscription } from "../../db";
import { BillingSettingsModel, TenantSubscriptionModel } from "../../db";
import {
  computeUnusedPortionCents,
  getStripeClient,
  nowInStripeSeconds,
} from "../../stripe";
import { CREDIT_NOTE_METADATA } from "../../operator-billing/credit-note-request";
import { MS_PER_DAY } from "../../utils/time";
import { loadBillingSettings } from "../../operator-billing/billing-settings-store";

const MONEY_BACK_REASON = "money_back_guarantee";
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

const REASON_TO_ERROR = new Map<string, RefundErrorMapping>([
  [
    REASON_NOT_ENABLED,
    { code: HTTP_FORBIDDEN, message: "saas.errors.refund.not_enabled" },
  ],
  [
    REASON_NO_SUBSCRIPTION,
    {
      code: HTTP_BAD_REQUEST,
      message: "saas.errors.workspace.no_active_subscription",
    },
  ],
  [
    REASON_ALREADY_PROCESSED,
    { code: HTTP_CONFLICT, message: "saas.errors.refund.already_processed" },
  ],
  [
    REASON_NO_INVOICE,
    { code: HTTP_NOT_FOUND, message: "saas.errors.invoice.no_paid_found" },
  ],
  [
    REASON_WINDOW_EXPIRED,
    { code: HTTP_FORBIDDEN, message: "saas.errors.refund.window_expired" },
  ],
]);

export interface EligibleInvoice {
  id: string;
  amountPaid: number;
  /** What is left to refund: the amount paid less the credit notes on it. */
  refundable: number;
  created: number;
  periodStart: number | null;
  periodEnd: number | null;
  currency: string | null;
}

export interface RefundEligibility {
  eligible: boolean;
  reason: string | null;
  windowDays: number;
  mode: string | null;
  /** The first paid invoice, also when its window is over. */
  invoice: EligibleInvoice | null;
  /**
   * Every payment the guarantee refunds: those made within the window, the
   * first one included. Empty once the window is over.
   */
  payments: EligibleInvoice[];
}

/** What the money-back guarantee card shows, eligible or not. */
export interface RefundEligibilityResponse {
  eligible: boolean;
  reason: string | null;
  windowDays: number;
  mode: string | null;
  refundAmount: number | null;
  currency: string | null;
  /** How many payments the refund gives back, while it can be claimed. */
  paymentsCount: number;
  /** When the first payment the guarantee covers was made. */
  firstPaymentAt: Date | null;
  /** When the window closes (or closed), counted from the first payment. */
  windowEndsAt: Date | null;
  /** When the workspace's one refund was requested. */
  refundedAt: Date | null;
}

/** One credit note of a refund: what it gives back on which invoice. */
interface InvoiceRefund {
  invoiceId: string;
  amount: number;
}

function isCharged(invoice: Stripe.Invoice): boolean {
  return invoice.amount_paid > 0;
}

function createdAt(invoice: Stripe.Invoice): number {
  return invoice.created ?? 0;
}

/**
 * The oldest of `invoices` that took money. A trial opens with a paid invoice
 * of zero, which is no payment: the guarantee covers the first real charge.
 *
 * @param invoices Paid invoices, in any order
 */
export function firstChargedInvoice(
  invoices: Stripe.Invoice[],
): Stripe.Invoice | null {
  return invoices
    .filter(isCharged)
    .reduce<Stripe.Invoice | null>(
      (oldest, invoice) =>
        !oldest || createdAt(invoice) < createdAt(oldest) ? invoice : oldest,
      null,
    );
}

/**
 * The payments the guarantee gives back: every invoice that took money
 * within `windowDays` of the first one, oldest first. An upgrade paid in the
 * window is refunded with the first payment, since the refund stops the
 * subscription it paid for.
 *
 * @param invoices Paid invoices, in any order
 */
export function chargedInvoicesInWindow(
  invoices: Stripe.Invoice[],
  windowDays: number,
): Stripe.Invoice[] {
  const first = firstChargedInvoice(invoices);
  if (!first) return [];
  const windowEnd = windowEndOf(createdAt(first), windowDays).getTime();
  return invoices
    .filter(
      (invoice) =>
        isCharged(invoice) && createdAt(invoice) * MS_PER_SECOND <= windowEnd,
    )
    .sort((left, right) => createdAt(left) - createdAt(right));
}

/**
 * Every paid invoice of the customer. Stripe returns them newest-first, one
 * page at a time: a customer with more than a page still gets their true
 * first invoice instead of the oldest of the last 100.
 */
async function listPaidInvoices(
  stripeCustomerId: string,
): Promise<Stripe.Invoice[]> {
  const stripe = getStripeClient();
  const invoices: Stripe.Invoice[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.invoices.list({
      customer: stripeCustomerId,
      status: "paid",
      limit: STRIPE_INVOICES_FETCH_LIMIT,
      starting_after: startingAfter,
    });
    invoices.push(...page.data);
    const lastId = page.data[page.data.length - 1]?.id;
    if (!page.has_more || !lastId) break;
    startingAfter = lastId;
  }
  return invoices;
}

function toEligibleInvoice(invoice: Stripe.Invoice): EligibleInvoice {
  const line = invoice.lines?.data?.[0];
  return {
    id: invoice.id as string,
    amountPaid: invoice.amount_paid,
    refundable: Math.max(
      0,
      invoice.amount_paid - (invoice.post_payment_credit_notes_amount ?? 0),
    ),
    created: createdAt(invoice),
    periodStart: line?.period?.start ?? null,
    periodEnd: line?.period?.end ?? null,
    currency: invoice.currency ?? null,
  };
}

function windowEndOf(invoiceCreated: number, windowDays: number): Date {
  return new Date(invoiceCreated * MS_PER_SECOND + windowDays * MS_PER_DAY);
}

function isWithinWindow(invoiceCreated: number, windowDays: number): boolean {
  return windowEndOf(invoiceCreated, windowDays).getTime() >= Date.now();
}

/**
 * What one payment gives back. Prorated, each invoice returns the unused
 * part of the period it paid for: an upgrade invoice already nets the old
 * plan's unused time, so the sum is the unused time at the current price.
 */
function computeInvoiceRefund(invoice: EligibleInvoice, mode: string): number {
  if (mode === FULL_REFUND_MODE) return invoice.refundable;
  const unused = computeUnusedPortionCents(
    invoice.amountPaid,
    invoice.periodStart,
    invoice.periodEnd,
    nowInStripeSeconds(),
  );
  return Math.min(unused, invoice.refundable);
}

function planRefunds(eligibility: RefundEligibility): InvoiceRefund[] {
  const mode = eligibility.mode ?? FULL_REFUND_MODE;
  return eligibility.payments
    .map((payment) => ({
      invoiceId: payment.id,
      amount: computeInvoiceRefund(payment, mode),
    }))
    .filter((refund) => refund.amount > 0);
}

function totalOf(refunds: InvoiceRefund[]): number {
  return refunds.reduce((total, refund) => total + refund.amount, 0);
}

async function resolveRefundEligibility(
  settings: BillingSettings,
  subscription: TenantSubscription | undefined,
): Promise<RefundEligibility> {
  const windowDays = settings.moneyBackGuaranteeWindowDays;
  const mode = settings.moneyBackGuaranteeMode;
  const base = { windowDays, mode, invoice: null, payments: [] };
  if (!settings.moneyBackGuaranteeEnabled) {
    return { eligible: false, reason: REASON_NOT_ENABLED, ...base };
  }
  if (!subscription?.stripeCustomerId || !subscription.stripeSubscriptionId) {
    return { eligible: false, reason: REASON_NO_SUBSCRIPTION, ...base };
  }
  if (subscription.refundRequestedAt) {
    return { eligible: false, reason: REASON_ALREADY_PROCESSED, ...base };
  }
  const paidInvoices = await listPaidInvoices(subscription.stripeCustomerId);
  const stripeInvoice = firstChargedInvoice(paidInvoices);
  if (!stripeInvoice?.id || !stripeInvoice.created) {
    return { eligible: false, reason: REASON_NO_INVOICE, ...base };
  }
  const invoice = toEligibleInvoice(stripeInvoice);
  if (!isWithinWindow(invoice.created, windowDays)) {
    return { ...base, eligible: false, reason: REASON_WINDOW_EXPIRED, invoice };
  }
  const payments = chargedInvoicesInWindow(paidInvoices, windowDays).map(
    toEligibleInvoice,
  );
  return { ...base, eligible: true, reason: null, invoice, payments };
}

/**
 * The guarantee as the owner reads it: the amount only while it can still be
 * claimed, the window's dates whenever a first payment is known.
 */
export function toEligibilityResponse(
  eligibility: RefundEligibility,
  refundedAt: Date | null,
): RefundEligibilityResponse {
  const { invoice, windowDays } = eligibility;
  const refunds = eligibility.eligible ? planRefunds(eligibility) : [];
  return {
    eligible: eligibility.eligible,
    reason: eligibility.reason,
    windowDays,
    mode: eligibility.mode,
    refundAmount: eligibility.eligible ? totalOf(refunds) : null,
    currency: invoice?.currency ?? null,
    paymentsCount: refunds.length,
    firstPaymentAt: invoice ? new Date(invoice.created * MS_PER_SECOND) : null,
    windowEndsAt: invoice ? windowEndOf(invoice.created, windowDays) : null,
    refundedAt,
  };
}

/**
 * Cancels the subscription, then refunds. Cancelling first means the
 * irreversible action (returning money) happens last: if the cancel fails, no
 * money has left yet, and the caller releases the refund claim so the request
 * can be retried. Every call uses a deterministic idempotency key, so a retry
 * never double-cancels or double-refunds.
 */
async function issueRefundAndCancel(
  subscriptionId: string,
  stripeSubscriptionId: string,
  refunds: InvoiceRefund[],
): Promise<void> {
  const stripe = getStripeClient();
  await stripe.subscriptions.cancel(stripeSubscriptionId, undefined, {
    idempotencyKey: `cancel-self-refund:${subscriptionId}`,
  });
  for (const refund of refunds) {
    await stripe.creditNotes.create(
      {
        invoice: refund.invoiceId,
        amount: refund.amount,
        refund_amount: refund.amount,
        memo: "Money-back guarantee self-service refund",
        reason: "order_change",
        metadata: { [CREDIT_NOTE_METADATA.reason]: MONEY_BACK_REASON },
      },
      { idempotencyKey: `refund-self:${subscriptionId}:${refund.invoiceId}` },
    );
  }
}

export class SaasBillingSelfRefundController extends Controller(
  "/api/saas/billing",
) {
  /**
   * Read under the access gate too: once the refund cancelled the
   * subscription the workspace is blocked, and the money-back card still has
   * to say when it was refunded.
   */
  @Get("/refund-eligibility")
  async getRefundEligibility(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @Model(BillingSettingsModel) billingSettingsModel: BillingSettingsModel,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<RefundEligibilityResponse> {
    const settings = await loadBillingSettings(billingSettingsModel);
    const subscription = await tenantSubscriptionModel.findOne();
    const eligibility = await resolveRefundEligibility(settings, subscription);
    return toEligibilityResponse(
      eligibility,
      subscription?.refundRequestedAt ?? null,
    );
  }

  /**
   * Refunds the customer and cancels the subscription. The refund claim is
   * released when the issue fails, so a partial failure (e.g. cancel succeeded
   * but a credit note call threw) can be retried; the deterministic
   * idempotency keys make the retry safe against double-cancel and
   * double-refund.
   */
  @Post("/refund-self")
  async requestSelfRefund(
    @AuthTenantOwner() _user: User,
    @Model(BillingSettingsModel) billingSettingsModel: BillingSettingsModel,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ) {
    const settings = await loadBillingSettings(billingSettingsModel);
    const subscription = await tenantSubscriptionModel.findOne();
    const eligibility = await resolveRefundEligibility(settings, subscription);
    const error = eligibility.eligible
      ? null
      : REASON_TO_ERROR.get(eligibility.reason ?? "");
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

    const refunds = planRefunds(eligibility);
    try {
      await issueRefundAndCancel(
        subscription._id,
        subscription.stripeSubscriptionId,
        refunds,
      );
    } catch (error) {
      await tenantSubscriptionModel
        .releaseSelfRefund(subscription._id)
        .catch(() => {});
      throw error;
    }
    return { refunded: totalOf(refunds) };
  }
}
