import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceModel, RefundModel, TenantSubscriptionModel } from "../src/db";
import { handleChargeRefundUpdated } from "../src/stripe/webhook-handlers";
import { upsertInvoice } from "../src/stripe/webhook-shared";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-mirror-keys");
const stripe = useSuiteStripe();

interface BilledWorkspace {
  tenantId: string;
  customerId: string;
  invoiceId: string;
  refundId: string;
  invoices: InvoiceModel;
  refunds: RefundModel;
}

let workspace: BilledWorkspace;

beforeEach(async () => {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status: "active",
    stripeCustomerId: customerId,
  });
  workspace = {
    tenantId,
    customerId,
    invoiceId: `in_${randomUUID()}`,
    refundId: `re_${randomUUID()}`,
    invoices: GetModel(InvoiceModel, tenantId),
    refunds: GetModel(RefundModel, tenantId),
  };
});

async function rowIds(model: InvoiceModel | RefundModel): Promise<string[]> {
  return (await model.getAll()).map((row) => row._id);
}

function stripeInvoice(status: Stripe.Invoice.Status): Stripe.Invoice {
  return {
    id: workspace.invoiceId,
    customer: workspace.customerId,
    number: "INV-0001",
    amount_due: 5935,
    subtotal: 5935,
    total_taxes: [],
    total: 5935,
    currency: "eur",
    status,
    status_transitions: { paid_at: null },
    metadata: {},
    created: 1_790_000_000,
    period_start: 1_790_000_000,
    period_end: 1_792_592_000,
    lines: { has_more: false, data: [] },
  } as unknown as Stripe.Invoice;
}

/** The invoice with more lines than its event carries: they are listed from Stripe. */
function pagedInvoice(status: Stripe.Invoice.Status): Stripe.Invoice {
  return fromPartial({
    ...stripeInvoice(status),
    lines: { has_more: true, data: [] },
  });
}

/**
 * Holds every listing of an invoice's lines until `writers` of them started:
 * each writer has looked its row up by then, and none has inserted yet.
 * Returns whether that many writers got there.
 */
function holdLinePagesUntil(writers: number): () => boolean {
  let started = 0;
  let release = (): void => undefined;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(stripe.write.invoices, "listLineItems").mockImplementation(() => {
    started += 1;
    if (started === writers) release();
    return fromPartial({
      autoPagingToArray: async () => {
        await allStarted;
        return [];
      },
    });
  });
  return () => started === writers;
}

function refundEvent(status: Stripe.Refund["status"]): Stripe.Event {
  return {
    id: `evt_refund_${status}`,
    type: "charge.refund.updated",
    data: {
      object: {
        id: workspace.refundId,
        charge: "ch_1",
        amount: 1200,
        currency: "eur",
        status,
        failure_reason: null,
      },
    },
  } as unknown as Stripe.Event;
}

describe("Stripe invoice collection state", () => {
  it("mirrors what Stripe is doing to collect the invoice", async () => {
    const retryAt = 1_790_300_000;
    await upsertInvoice(
      {
        ...stripeInvoice("open"),
        amount_paid: 1_000,
        attempt_count: 2,
        next_payment_attempt: retryAt,
        due_date: null,
        automatically_finalizes_at: null,
        latest_revision: { id: "in_2" },
      } as unknown as Stripe.Invoice,
      workspace.tenantId,
    );

    await expect(
      workspace.invoices.get(workspace.invoiceId),
    ).resolves.toMatchObject({
      amountPaid: 1_000,
      attemptCount: 2,
      nextPaymentAttemptAt: new Date(retryAt * 1_000),
      dueAt: null,
      autoFinalizesAt: null,
      latestRevisionStripeId: "in_2",
    });
  });
});

describe("Stripe invoice mirror keys", () => {
  it("keeps concurrent events of one invoice to a single row", async () => {
    const bothLookedUp = holdLinePagesUntil(2);

    await Promise.all([
      upsertInvoice(pagedInvoice("open"), workspace.tenantId),
      upsertInvoice(pagedInvoice("paid"), workspace.tenantId),
    ]);

    expect(bothLookedUp()).toBe(true);
    await expect(rowIds(workspace.invoices)).resolves.toEqual([
      workspace.invoiceId,
    ]);
    await expect(
      workspace.invoices.get(workspace.invoiceId),
    ).resolves.toMatchObject({ stripeInvoiceId: workspace.invoiceId });
  });

  it("updates a legacy row found by its Stripe id instead of adding one", async () => {
    const legacyId = randomUUID();
    await workspace.invoices.insert({
      _id: legacyId,
      stripeInvoiceId: workspace.invoiceId,
      stripeCreditNoteId: null,
      status: "open",
    });

    await upsertInvoice(stripeInvoice("paid"), workspace.tenantId);

    await expect(rowIds(workspace.invoices)).resolves.toEqual([legacyId]);
    await expect(workspace.invoices.get(legacyId)).resolves.toMatchObject({
      status: "paid",
    });
  });
});

describe("Stripe refund mirror keys", () => {
  it("keeps concurrent events of one refund to a single row", async () => {
    vi.spyOn(stripe.write.charges, "retrieve").mockResolvedValue(
      fromPartial({ customer: workspace.customerId }),
    );

    await Promise.all([
      handleChargeRefundUpdated(refundEvent("pending")),
      handleChargeRefundUpdated(refundEvent("failed")),
    ]);

    await expect(rowIds(workspace.refunds)).resolves.toEqual([
      workspace.refundId,
    ]);
    await expect(
      workspace.refunds.get(workspace.refundId),
    ).resolves.toMatchObject({ stripeRefundId: workspace.refundId });
  });
});
