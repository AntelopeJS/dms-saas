import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { InvoiceModel, TenantSubscriptionModel } from "../../src/db";

const CREATED_SECONDS = 1_788_264_000;

/** A workspace credited on Stripe, and what Stripe sends and answers for it. */
export interface CreditedWorkspace {
  tenantId: string;
  /** The `credit_note.created` event Stripe sends. */
  event: Stripe.Event;
  /** What Stripe answers when the credit note is retrieved. */
  creditNote: Stripe.CreditNote;
}

/**
 * Stores a workspace whose Stripe customer got a credit note on an invoice
 * already mirrored, and builds the `credit_note.created` event Stripe sends
 * for it. Needs a database (`useMongoDatabase`).
 */
export async function creditedWorkspace(): Promise<CreditedWorkspace> {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  const stripeInvoiceId = `in_${randomUUID()}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    stripeCustomerId: customerId,
  });
  await GetModel(InvoiceModel, tenantId).insert({
    _id: randomUUID(),
    documentType: "invoice",
    stripeInvoiceId,
    stripeCreditNoteId: null,
    number: "INV-0042",
    periodStart: new Date("2026-08-01T00:00:00.000Z"),
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
  });
  const creditNote = fromPartial<Stripe.CreditNote>({
    id: `cn_${randomUUID()}`,
    object: "credit_note",
    amount: 3_600,
    created: CREATED_SECONDS,
    currency: "eur",
    customer: customerId,
    invoice: stripeInvoiceId,
    lines: { object: "list", data: [], has_more: false, url: "" },
    number: "CN-0042-1",
    reason: "order_change",
    refunds: [],
    status: "issued",
    subtotal: 3_000,
    total_taxes: [],
    total: 3_600,
    type: "post_payment",
  });
  const event = fromPartial<Stripe.Event>({
    id: `evt_${randomUUID()}`,
    type: "credit_note.created",
    data: { object: { id: creditNote.id, customer: customerId } },
  });
  return { tenantId, event, creditNote };
}
