import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import { recomputeTenantBillingState } from "../billing-state";
import type {
  Invoice,
  InvoiceLine,
  TenantSubscription,
  TenantSubscriptionStatus,
} from "../db";
import { INVOICE_STATUSES, InvoiceModel, TenantSubscriptionModel } from "../db";
import { isGuardedPlanChangeBlocked } from "../plan-changes/guarded-state";
import {
  getRowInstance,
  insertOrUpdateById,
  stripeSecondsToDate as optionalStripeDate,
} from "../utils";
import { getStripeClient } from "./client";
import {
  readInvoiceTax,
  readStripeId,
  requireInvoiceId,
} from "./payload-shapes";
import { isString } from "../utils/primitive-guards";

export const ACTIVE_STATUS = "active" satisfies TenantSubscriptionStatus;
export const TRIALING_STATUS = "trialing" satisfies TenantSubscriptionStatus;
export const PAST_DUE_STATUS = "past_due" satisfies TenantSubscriptionStatus;
export const CENTS_PER_UNIT = 100;

export interface TenantRef {
  _id: string;
}

export async function findTenantByCustomerId(
  customerId: string,
): Promise<TenantRef | null> {
  const tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );
  const sub = await tenantSubscriptionModel.findOneByStripeCustomer(customerId);
  if (!sub) return null;
  return { _id: getRowInstance(sub) };
}

const STATUS_WRITE_ATTEMPTS = 3;

/**
 * Paying an old invoice cannot grant an unvalidated Free plan or erase its
 * incident: while a guarded plan change is pending, cancellation and an
 * unblocking `active` are ignored. Cancellation events for this operation have
 * their own landing. Entering past_due arms the dunning clock unless an episode
 * is already running; leaving it disarms structurally (see DunningClock on the
 * table).
 *
 * The write lands on the revision these checks read, and `admits` judges that
 * same revision: a concurrent writer sends it back to read and decide again.
 *
 * @returns Whether the status was written.
 */
async function writeSubscriptionStatus(
  tenantId: string,
  status: TenantSubscriptionStatus,
  admits: (subscription: TenantSubscription) => boolean,
): Promise<boolean> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  for (let attempt = 0; attempt < STATUS_WRITE_ATTEMPTS; attempt += 1) {
    const subscription = await tenantSubscriptionModel.findOne();
    if (!subscription || !admits(subscription)) return false;
    if (
      subscription.guardedPlanChange &&
      (status === "cancelled" ||
        (status === "active" && isGuardedPlanChangeBlocked(subscription)))
    )
      return false;
    if (subscription.deletionStartedAt || subscription.domainTransition)
      throw new Error("Subscription transition requires reconciliation");
    const patch: Partial<TenantSubscription> = {
      status,
      updatedAt: new Date(),
    };
    if (status === PAST_DUE_STATUS) {
      patch.pastDueSince = subscription.pastDueSince ?? new Date();
    }
    const outcome = await tenantSubscriptionModel.mutateRevision(
      subscription,
      patch,
    );
    if (outcome === "unknown")
      throw new Error("Subscription status outcome is unknown");
    if (outcome === "applied") {
      await recomputeTenantBillingState(tenantId);
      return true;
    }
  }
  throw new Error("Subscription status kept conflicting; reload before retry");
}

export async function updateSubscriptionStatus(
  tenantId: string,
  status: Exclude<TenantSubscriptionStatus, "cancelled">,
): Promise<void> {
  await writeSubscriptionStatus(tenantId, status, () => true);
}

/**
 * Cancels the workspace only while it still bills on `stripeSubscriptionId`:
 * once an operator's grant or a plan migration moved it elsewhere, that
 * subscription's deletion is not the workspace churning.
 *
 * @returns Whether the workspace was cancelled.
 */
export async function cancelSubscriptionBilledOn(
  tenantId: string,
  stripeSubscriptionId: string,
): Promise<boolean> {
  return writeSubscriptionStatus(
    tenantId,
    "cancelled",
    (subscription) =>
      subscription.stripeSubscriptionId === stripeSubscriptionId,
  );
}

export function formatAmount(amountInCents: number, currency: string): string {
  return `${(amountInCents / CENTS_PER_UNIT).toFixed(2)} ${currency.toUpperCase()}`;
}

/** A Stripe reference: the id, or the object when the request expanded it. */
type ExpandableReference = string | { id: string } | null | undefined;

export function asCustomerId(field: ExpandableReference): string | null {
  if (isString(field)) return field;
  return null;
}

export const INVOICE_LINES_PAGE_SIZE = 100;
const INVOICE_LINES_HARD_CAP = 1000;

export function toInvoiceLine(line: Stripe.InvoiceLineItem): InvoiceLine {
  return {
    description: line.description ?? "",
    quantity: line.quantity,
    amount: line.amount,
    currency: line.currency,
    periodStart: optionalStripeDate(line.period?.start),
    periodEnd: optionalStripeDate(line.period?.end),
  };
}

/**
 * The webhook payload embeds only the first page of the lines collection
 * while the invoice totals cover everything; mirroring just that page would
 * show a breakdown that does not add up to the displayed total. A fetch
 * failure propagates so Stripe's redelivery replays the upsert.
 */
export async function resolveInvoiceLines(
  invoice: Stripe.Invoice,
): Promise<InvoiceLine[]> {
  if (!invoice.lines.has_more) return invoice.lines.data.map(toInvoiceLine);
  const stripe = getStripeClient();
  const lines = await stripe.invoices
    .listLineItems(requireInvoiceId(invoice), {
      limit: INVOICE_LINES_PAGE_SIZE,
    })
    .autoPagingToArray({ limit: INVOICE_LINES_HARD_CAP });
  return lines.map(toInvoiceLine);
}

/** Where Stripe stands with collecting an invoice: what the operator list reads. */
export type InvoiceCollectionState = Pick<
  Invoice,
  | "amountPaid"
  | "attemptCount"
  | "nextPaymentAttemptAt"
  | "dueAt"
  | "autoFinalizesAt"
  | "latestRevisionStripeId"
>;

/** The collection state of a document nobody collects: a credit note. */
export const NO_COLLECTION_STATE: InvoiceCollectionState = {
  amountPaid: 0,
  attemptCount: 0,
  nextPaymentAttemptAt: null,
  dueAt: null,
  autoFinalizesAt: null,
  latestRevisionStripeId: null,
};

function toCollectionState(invoice: Stripe.Invoice): InvoiceCollectionState {
  return {
    amountPaid: invoice.amount_paid,
    attemptCount: invoice.attempt_count,
    nextPaymentAttemptAt: optionalStripeDate(invoice.next_payment_attempt),
    dueAt: optionalStripeDate(invoice.due_date),
    autoFinalizesAt: optionalStripeDate(invoice.automatically_finalizes_at),
    latestRevisionStripeId: readStripeId(invoice.latest_revision),
  };
}

function toInvoicePayload(invoice: Stripe.Invoice, lines: InvoiceLine[]) {
  return {
    ...toCollectionState(invoice),
    documentType: "invoice" as const,
    stripeInvoiceId: requireInvoiceId(invoice),
    stripeCreditNoteId: null,
    number: invoice.number ?? null,
    parentInvoiceNumber: null,
    amount: invoice.amount_due,
    subtotal: invoice.subtotal,
    tax: readInvoiceTax(invoice),
    total: invoice.total,
    currency: invoice.currency,
    status:
      INVOICE_STATUSES.find((status) => status === invoice.status) ?? "open",
    creditNoteReason: null,
    creditNoteType: null,
    memo: null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    metadata: invoice.metadata ?? {},
    periodStart: optionalStripeDate(invoice.period_start),
    periodEnd: optionalStripeDate(invoice.period_end),
    lines,
    paidAt:
      invoice.status === "paid" && invoice.status_transitions.paid_at
        ? optionalStripeDate(invoice.status_transitions.paid_at)
        : null,
    voidedAt: null,
    issuedAt: optionalStripeDate(invoice.created) ?? new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Every invoice.* event of one invoice mirrors it, concurrently and across the
 * Stripe round-trip for its lines: keying the row by the Stripe id is what
 * keeps them to one row. Legacy rows keep their random key and are found by
 * the Stripe invoice lookup.
 */
export async function upsertInvoice(
  invoice: Stripe.Invoice,
  tenantId: string,
): Promise<void> {
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const invoiceId = requireInvoiceId(invoice);
  const existing = await invoiceModel.findOneByStripeInvoice(invoiceId);
  const payload = toInvoicePayload(invoice, await resolveInvoiceLines(invoice));
  if (existing) {
    await invoiceModel.update(existing._id, payload);
    return;
  }
  await insertOrUpdateById(
    invoiceModel,
    invoiceId,
    { ...payload, _id: invoiceId, createdAt: new Date() },
    payload,
  );
}

export interface MirroredInvoice {
  invoice: Stripe.Invoice;
  customerId: string;
  tenantId: string;
}

export interface MirroredCreditNote {
  creditNote: Stripe.CreditNote;
  tenantId: string;
  isCurrent: boolean;
}

export async function mirrorInvoiceFromEvent(
  event: Stripe.InvoiceCreatedEvent | Stripe.InvoiceFinalizedEvent,
): Promise<MirroredInvoice | null> {
  const invoice = event.data.object;
  const customerId = asCustomerId(invoice.customer);
  if (!customerId) return null;
  const tenant = await findTenantByCustomerId(customerId);
  if (!tenant) return null;
  await upsertInvoice(invoice, tenant._id);
  return { invoice, customerId, tenantId: tenant._id };
}
