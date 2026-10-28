import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreditNoteModel,
  InvoiceModel,
  StripeWebhookEventModel,
  TenantSubscriptionModel,
} from "../src/db";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-webhook-credit-note-idempotence");
const stripe = useSuiteStripe();

const CREATED_SECONDS = 1_788_264_000;

interface CreditedWorkspace {
  tenantId: string;
  event: Stripe.Event;
  creditNote: Stripe.CreditNote;
}

let workspace: CreditedWorkspace;

/**
 * A workspace whose Stripe customer got a credit note on an invoice already
 * mirrored, and the `credit_note.created` event Stripe sends for it.
 */
async function creditedWorkspace(): Promise<CreditedWorkspace> {
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

function stubCreditNoteRead() {
  return vi
    .spyOn(stripe.write.creditNotes, "retrieve")
    .mockResolvedValue(fromPartial(workspace.creditNote));
}

beforeEach(async () => {
  workspace = await creditedWorkspace();
});

describe("credit note webhook event claims", () => {
  it("processes a successful event only once", async () => {
    const retrieve = stubCreditNoteRead();

    await dispatchStripeWebhookEvent(workspace.event);
    await dispatchStripeWebhookEvent(workspace.event);

    expect(retrieve).toHaveBeenCalledOnce();
    await expect(
      GetModel(StripeWebhookEventModel).get(workspace.event.id),
    ).resolves.toMatchObject({ result: "success" });
    await expect(
      GetModel(CreditNoteModel, workspace.tenantId).findOneByStripeCreditNote(
        workspace.creditNote.id,
      ),
    ).resolves.toMatchObject({ amount: 3_600 });
  });

  it("does not replay a handler whose partial effects are uncertain", async () => {
    const retrieve = stubCreditNoteRead();
    retrieve.mockRejectedValueOnce(new Error("temporary database outage"));

    await expect(dispatchStripeWebhookEvent(workspace.event)).rejects.toThrow(
      "temporary database outage",
    );
    await expect(dispatchStripeWebhookEvent(workspace.event)).rejects.toThrow(
      "reconciliation",
    );

    expect(retrieve).toHaveBeenCalledOnce();
    await expect(
      GetModel(StripeWebhookEventModel).get(workspace.event.id),
    ).resolves.toMatchObject({ result: "reconciliation_required" });
  });
});
