import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { emitAutomationEvent } from "../automation";
import type {
  RefundStatus,
  TenantBillingAddress,
  TenantBillingInfo,
  TenantCustomerType,
  TenantSubscriptionStatus,
  VatVerificationStatus,
} from "../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  InvoiceModel,
  RefundModel,
  TenantBillingInfoModel,
  TenantSubscriptionModel,
} from "../db";
import { injectProvidedInvoiceLineItems } from "../invoice-line-items";
import {
  notifyTenantMembers,
  notifyTenantOwners,
  paymentFailedSubject,
  refundProcessedSubject,
  subscriptionCancelledSubject,
  trialEndedBlockedSubject,
  trialEndingSoonSubject,
} from "../notifications";
import {
  applyPendingFreePlanOnCancellation,
  applyPendingPlanChangeIfEntered,
  reconcilePendingWithStripe,
} from "../plan-changes";
import { stripeSecondsToDate as optionalStripeDate } from "../utils";
import { getStripeClient } from "./client";
import {
  fetchPrimaryTaxId,
  type TaxIdSnapshot,
  toVatVerificationStatus,
} from "./customer-billing";
import { computeUnusedPortionCents, nowInStripeSeconds } from "./proration";
import {
  ACTIVE_STATUS,
  asCustomerId,
  findTenantByCustomerId,
  formatAmount,
  mirrorInvoiceFromEvent,
  PAST_DUE_STATUS,
  updateSubscriptionStatus,
  upsertInvoice,
} from "./webhook-shared";

const BUSINESS_CUSTOMER_TYPE: TenantCustomerType = "business";
const SUSPENDED_STATUS: TenantSubscriptionStatus = "suspended";
const CANCELLED_STATUS: TenantSubscriptionStatus = "cancelled";
const REACTIVATABLE_STATUSES = new Set<TenantSubscriptionStatus>([
  PAST_DUE_STATUS,
  SUSPENDED_STATUS,
]);
const PAYMENT_FAILED_ICON = "i-ph-x-circle";
const REFUND_ICON = "i-ph-arrow-counter-clockwise";
const SUBSCRIPTION_CANCELLED_ICON = "i-ph-x";
const TRIAL_ENDING_ICON = "i-ph-hourglass";
const TRIAL_ENDED_BLOCKED_ICON = "i-ph-prohibit";

const SINGLE_INVOICE_FETCH_LIMIT = 1;
const AUTO_PRORATA_METADATA_KEY = "saasAutoProrataOf";

const TRIAL_BLOCKED_STRIPE_STATUSES = new Set<string>([
  "past_due",
  "unpaid",
  "incomplete_expired",
]);

export async function handleInvoiceCreated(event: Stripe.Event): Promise<void> {
  const mirrored = await mirrorInvoiceFromEvent(event);
  if (!mirrored) return;
  await injectProvidedInvoiceLineItems(
    mirrored.invoice,
    mirrored.tenantId,
    mirrored.customerId,
  );
}

export async function handleInvoiceFinalized(
  event: Stripe.Event,
): Promise<void> {
  await mirrorInvoiceFromEvent(event);
}

export async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = asCustomerId(invoice.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  await upsertInvoice(invoice, tenant._id);
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenant._id);
  const subscription = await tenantSubscriptionModel.findOne();
  if (subscription && REACTIVATABLE_STATUSES.has(subscription.status)) {
    // Only the payment that clears the last open invoice lifts the block: a
    // small proration or one-off paid while the renewal invoice stays open
    // must not reactivate — each lift would also restamp pastDueSince on the
    // next failure, pushing the suspension deadline out forever.
    const invoiceModel = GetModel(InvoiceModel, tenant._id);
    const stillOpen = await invoiceModel.findLatestOpen();
    if (!stillOpen) {
      await updateSubscriptionStatus(tenant._id, ACTIVE_STATUS);
    }
  }
}

export async function handleInvoiceVoided(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = asCustomerId(invoice.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  await upsertInvoice(invoice, tenant._id);
}

export async function handleInvoicePaymentFailed(
  event: Stripe.Event,
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = asCustomerId(invoice.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  await upsertInvoice(invoice, tenant._id);
  // The final dunning failure and the cancellation race with no ordering
  // guarantee: a late payment_failed must not resurrect a cancelled mirror
  // into past_due — the retention cron would never find the tenant again and
  // the auto-suspend cron would park it suspended for good.
  const localSubscription = await GetModel(
    TenantSubscriptionModel,
    tenant._id,
  ).findOne();
  if (localSubscription?.status === CANCELLED_STATUS) return;
  await updateSubscriptionStatus(tenant._id, PAST_DUE_STATUS);
  emitAutomationEvent("saas.payment-failed", {
    tenantId: tenant._id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number ?? null,
    amountDue: invoice.amount_due,
    currency: invoice.currency,
    at: new Date().toISOString(),
  });
  await notifyTenantOwners(tenant._id, paymentFailedSubject, {
    icon: PAYMENT_FAILED_ICON,
    title: "Payment failed",
    description: `Invoice ${invoice.number ?? invoice.id} failed (${formatAmount(invoice.amount_due, invoice.currency)}).`,
  });
}

async function applyAutoProrataIfEnabled(
  customerId: string,
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const billingSettingsModel = GetModel(BillingSettingsModel);
  const settings = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  if (!settings?.autoProrataOnCancelEnabled) return;
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const localSubscription = await tenantSubscriptionModel.findOne();
  if (localSubscription?.refundRequestedAt) return;
  const stripe = getStripeClient();
  const invoices = await stripe.invoices.list({
    customer: customerId,
    status: "paid",
    limit: SINGLE_INVOICE_FETCH_LIMIT,
  });
  const lastInvoice = invoices.data[0];
  if (!lastInvoice?.id) return;

  // The redelivery of a handler that failed *after* this create (a transient
  // notification error is enough) replays the whole cancellation path; the
  // metadata marker plus the idempotency key are what keep it from refunding
  // the customer a second time.
  const existingNotes = await stripe.creditNotes.list({
    invoice: lastInvoice.id,
  });
  const alreadyIssued = existingNotes.data.some(
    (note) => note.metadata?.[AUTO_PRORATA_METADATA_KEY] === subscription.id,
  );
  if (alreadyIssued) return;

  const remaining = computeUnusedPortionCents(
    lastInvoice.amount_paid,
    subscription.current_period_start,
    subscription.current_period_end,
    // The cancellation instant, not the processing instant: a redelivery must
    // compute the same amount, or the idempotency key below would reject the
    // replay as a changed request instead of deduplicating it.
    subscription.ended_at ?? nowInStripeSeconds(),
  );
  if (remaining <= 0) return;

  await stripe.creditNotes.create(
    {
      invoice: lastInvoice.id,
      amount: remaining,
      refund_amount: remaining,
      reason: "order_change",
      memo: "Automatic prorated refund on cancellation",
      metadata: { [AUTO_PRORATA_METADATA_KEY]: subscription.id },
    },
    { idempotencyKey: `auto-prorata:${subscription.id}` },
  );
}

export async function handleSubscriptionDeleted(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = asCustomerId(subscription.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  // A cycle-end cancellation parked behind a free plan is a completed
  // downgrade, not a churn: no cancellation status, no prorata, no notice.
  if (await applyPendingFreePlanOnCancellation(tenant._id)) return;
  await updateSubscriptionStatus(tenant._id, CANCELLED_STATUS);
  await applyAutoProrataIfEnabled(customerId, tenant._id, subscription);
  // Emit once every cancellation side effect (incl. prorata) is in place.
  emitAutomationEvent("saas.subscription-cancelled", {
    tenantId: tenant._id,
    stripeSubscriptionId: subscription.id,
    at: new Date().toISOString(),
  });
  await notifyTenantOwners(tenant._id, subscriptionCancelledSubject, {
    icon: SUBSCRIPTION_CANCELLED_ICON,
    title: "Subscription cancelled",
    description: "Your subscription has been cancelled.",
  });
}

export async function handleTrialWillEnd(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = asCustomerId(subscription.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  await notifyTenantMembers(tenant._id, trialEndingSoonSubject, {
    icon: TRIAL_ENDING_ICON,
    title: "Trial ending soon",
    description: "Your trial ends in 3 days.",
  });
  emitAutomationEvent("saas.trial-ending", {
    tenantId: tenant._id,
    trialEndsAt: subscription.trial_end
      ? (optionalStripeDate(subscription.trial_end)?.toISOString() ?? null)
      : null,
    at: new Date().toISOString(),
  });
}

async function persistSubscriptionPeriod(
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const local = await tenantSubscriptionModel.findOne();
  if (!local) return;
  const currentPeriodEnd = optionalStripeDate(subscription.current_period_end);
  if (local.currentPeriodEnd?.getTime() === currentPeriodEnd?.getTime()) return;
  await tenantSubscriptionModel.update(local._id, { currentPeriodEnd });
}

async function handleTrialTransition(
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  if (TRIAL_BLOCKED_STRIPE_STATUSES.has(subscription.status)) {
    await updateSubscriptionStatus(tenantId, PAST_DUE_STATUS);
    await notifyTenantOwners(tenantId, trialEndedBlockedSubject, {
      icon: TRIAL_ENDED_BLOCKED_ICON,
      title: "Trial ended",
      description:
        "Your trial has ended and access is blocked. Update your payment method to restore access.",
    });
    return;
  }
  // Trial converted successfully (trialing -> active): keep the local status in sync.
  if (subscription.status === "active") {
    await updateSubscriptionStatus(tenantId, ACTIVE_STATUS);
  }
}

export async function handleSubscriptionUpdated(
  event: Stripe.Event,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = asCustomerId(subscription.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  // Every update carries the renewal date, and a scheduled downgrade lands as
  // one of them, so neither can hang off the trial-only branch below.
  await persistSubscriptionPeriod(tenant._id, subscription);
  await applyPendingPlanChangeIfEntered(tenant._id, subscription);
  await reconcilePendingWithStripe(tenant._id, subscription);
  const previousAttributes = event.data.previous_attributes as
    | Partial<Stripe.Subscription>
    | undefined;
  if (previousAttributes?.status !== "trialing") return;
  await handleTrialTransition(tenant._id, subscription);
}

function stripeAddressToTenant(
  address: Stripe.Address | null | undefined,
): TenantBillingAddress | null {
  if (!address) return null;
  return {
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    postalCode: address.postal_code ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? null,
  };
}

export async function handleCustomerUpdated(
  event: Stripe.Event,
): Promise<void> {
  const customer = event.data.object as Stripe.Customer;
  const tenant = await findTenantByCustomerId(customer.id);
  if (!tenant) return;
  const billingInfoModel = GetModel(TenantBillingInfoModel, tenant._id);
  const existing = await billingInfoModel.findOne();
  if (!existing) return;
  const isBusiness = existing.customerType === BUSINESS_CUSTOMER_TYPE;
  const snapshot = await fetchPrimaryTaxId(customer.id);
  const vat = resolveVatFields(existing, isBusiness, snapshot);
  await billingInfoModel.update(existing._id, {
    address: stripeAddressToTenant(customer.address),
    ...vat,
    // The customer portal lets the customer edit their e-mail directly on
    // Stripe; the mirror follows it like it follows the address.
    billingEmail: customer.email ?? existing.billingEmail,
    companyName: isBusiness
      ? (customer.name ?? existing.companyName)
      : existing.companyName,
  });
}

interface VatFields {
  vatNumber: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
}

function resolveVatFields(
  existing: TenantBillingInfo,
  isBusiness: boolean,
  snapshot: TaxIdSnapshot,
): VatFields {
  if (!isBusiness) return { vatNumber: null, vatVerificationStatus: null };
  if (!snapshot.reachable) {
    return {
      vatNumber: existing.vatNumber,
      vatVerificationStatus: existing.vatVerificationStatus ?? null,
    };
  }
  return {
    vatNumber: snapshot.taxId?.value ?? null,
    vatVerificationStatus: snapshot.taxId
      ? toVatVerificationStatus(snapshot.taxId)
      : null,
  };
}

export async function handleChargeRefundUpdated(
  event: Stripe.Event,
): Promise<void> {
  const refund = event.data.object as Stripe.Refund;
  const chargeId = asCustomerId(refund.charge);
  if (!chargeId) return;
  const stripe = getStripeClient();
  const charge = await stripe.charges.retrieve(chargeId);
  const customerId = asCustomerId(charge.customer);
  if (!customerId) return;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return;
  const refundModel = GetModel(RefundModel, tenant._id);
  const existing = await refundModel.findOneByStripeRefund(refund.id);
  const payload = {
    creditNoteId: existing?.creditNoteId ?? "",
    stripeRefundId: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: (refund.status ?? "pending") as RefundStatus,
    failureReason: refund.failure_reason ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await refundModel.update(existing._id, payload);
  } else {
    await refundModel.insert({
      ...payload,
      createdAt: new Date(),
    });
  }
  if (refund.status === "succeeded") {
    await notifyTenantOwners(tenant._id, refundProcessedSubject, {
      icon: REFUND_ICON,
      title: "Refund processed",
      description: `Refund of ${formatAmount(refund.amount, refund.currency)} processed.`,
    });
  }
}
