import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import type Stripe from "stripe";
import {
  type CreditNote,
  CreditNoteModel,
  type Invoice,
  type InvoiceLine,
  type InvoiceModel,
  TenantSubscriptionModel,
} from "../db";
import {
  fetchDefaultPaymentMethod,
  type PaymentMethodSummary,
} from "../billing-state/recovery";
import { getStripeClient } from "../stripe/client";
import { asCustomerId } from "../stripe/webhook-shared";
import { getRowInstance } from "../utils";
import {
  type CreditAllowance,
  creditAllowance,
  sumIssuedCredits,
} from "./credit-allowance";

const HTTP_NOT_FOUND = 404;
const INVOICE_DOCUMENT_TYPE = "invoice";
const PAYMENT_METHOD_EXPANSION =
  "payments.data.payment.payment_intent.payment_method";

/** A credit note already issued against the invoice, as the dialog lists it. */
export interface PriorCredit {
  number: string;
  amount: number;
  currency: string;
  type: string;
  status: string;
  issuedAt: Date;
}

/** Everything the credit note dialog shows before anything is sent. */
export interface CreditNotePreview extends CreditAllowance {
  invoice: {
    _id: string;
    number: string | null;
    status: string;
    currency: string;
    total: number;
    tax: number;
    amountPaid: number;
    paidAt: Date | null;
    autoFinalizesAt: Date | null;
    lines: InvoiceLine[];
  };
  workspaceName: string;
  priorCredits: PriorCredit[];
  card: PaymentMethodSummary | null;
  /** When the next invoice deducts a balance credit, if one is due. */
  nextInvoiceAt: Date | null;
}

/** An invoice row read across workspaces, with the workspace it belongs to. */
export interface LoadedInvoice {
  invoice: Invoice;
  tenantId: string;
}

/**
 * Reads an invoice across workspaces, refusing a credit-note projection row.
 *
 * @param invoiceModel Cross-instance invoice model
 * @param invoiceId Row id of the invoice
 */
export async function loadInvoice(
  invoiceModel: InvoiceModel,
  invoiceId: string,
): Promise<LoadedInvoice> {
  const invoice = await invoiceModel.get(invoiceId);
  assert(
    invoice?.documentType === INVOICE_DOCUMENT_TYPE,
    HTTP_NOT_FOUND,
    "saas.errors.invoice.not_found",
  );
  return { invoice, tenantId: getRowInstance(invoice) };
}

function toPriorCredit(note: CreditNote): PriorCredit {
  return {
    number: note.number,
    amount: note.amount,
    currency: note.currency,
    type: note.type,
    status: note.status,
    issuedAt: note.issuedAt,
  };
}

async function readStripeInvoice(
  stripeInvoiceId: string,
): Promise<Stripe.Invoice> {
  return getStripeClient().invoices.retrieve(stripeInvoiceId, {
    expand: [PAYMENT_METHOD_EXPANSION],
  });
}

/**
 * What was already credited: the mirror may lag Stripe by a webhook, Stripe
 * may not have heard of a note being voided yet, so the larger sum wins.
 */
function creditedAmount(
  priorNotes: readonly CreditNote[],
  stripeInvoice: Stripe.Invoice,
): number {
  const fromStripe =
    (stripeInvoice.pre_payment_credit_notes_amount ?? 0) +
    (stripeInvoice.post_payment_credit_notes_amount ?? 0);
  return Math.max(sumIssuedCredits(priorNotes), fromStripe);
}

/**
 * What can still be credited on the invoice, read from the mirror and from
 * Stripe: the status Stripe reports now, the credits both know of.
 *
 * @param loaded The invoice and its workspace
 */
export async function resolveCreditAllowance(loaded: LoadedInvoice): Promise<{
  allowance: CreditAllowance;
  priorNotes: CreditNote[];
  stripeInvoice: Stripe.Invoice;
}> {
  const { invoice, tenantId } = loaded;
  const [priorNotes, stripeInvoice] = await Promise.all([
    GetModel(CreditNoteModel, tenantId).findByInvoice(invoice._id),
    readStripeInvoice(invoice.stripeInvoiceId),
  ]);
  const status = stripeInvoice.status ?? invoice.status;
  const allowance = creditAllowance(
    { status, total: stripeInvoice.total ?? invoice.total },
    creditedAmount(priorNotes, stripeInvoice),
  );
  return { allowance, priorNotes, stripeInvoice };
}

function paymentCard(
  stripeInvoice: Stripe.Invoice,
): PaymentMethodSummary | null {
  const payment = stripeInvoice.payments?.data.find(
    (entry) => typeof entry.payment.payment_intent === "object",
  )?.payment.payment_intent as Stripe.PaymentIntent | undefined;
  const card = payment?.payment_method;
  if (!card || typeof card === "string" || !card.card) return null;
  return {
    brand: card.card.brand,
    last4: card.card.last4,
    expMonth: card.card.exp_month,
    expYear: card.card.exp_year,
  };
}

async function resolveCard(
  stripeInvoice: Stripe.Invoice,
): Promise<PaymentMethodSummary | null> {
  const card = paymentCard(stripeInvoice);
  if (card) return card;
  const customerId = asCustomerId(stripeInvoice.customer);
  return customerId ? fetchDefaultPaymentMethod(customerId) : null;
}

async function workspaceContext(tenantId: string) {
  const [tenant, subscription] = await Promise.all([
    GetModel(TenantModel).get(tenantId),
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
  ]);
  return {
    workspaceName: tenant?.name ?? "",
    nextInvoiceAt: subscription?.currentPeriodEnd ?? null,
  };
}

/**
 * The credit note dialog's data: the invoice, what was credited and what is
 * left, the card a refund goes back to and when a balance credit is used.
 *
 * @param loaded The invoice and its workspace
 */
export async function buildCreditNotePreview(
  loaded: LoadedInvoice,
): Promise<CreditNotePreview> {
  const { invoice, tenantId } = loaded;
  const { allowance, priorNotes, stripeInvoice } =
    await resolveCreditAllowance(loaded);
  const [card, context] = await Promise.all([
    resolveCard(stripeInvoice),
    workspaceContext(tenantId),
  ]);
  return {
    ...allowance,
    ...context,
    card,
    priorCredits: priorNotes.map(toPriorCredit),
    invoice: {
      _id: invoice._id,
      number: invoice.number,
      status: stripeInvoice.status ?? invoice.status,
      currency: invoice.currency,
      total: invoice.total,
      tax: invoice.tax,
      amountPaid: stripeInvoice.amount_paid ?? invoice.amountPaid ?? 0,
      paidAt: invoice.paidAt,
      autoFinalizesAt: invoice.autoFinalizesAt ?? null,
      lines: invoice.lines ?? [],
    },
  };
}
