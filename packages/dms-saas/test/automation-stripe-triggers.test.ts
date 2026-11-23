import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAutomationNodes } from "../src/automation";
import {
  type TenantSubscriptionStatus,
  TenantSubscriptionModel,
} from "../src/db";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { armTrigger, implementAutomationCatalog } from "./helpers/automation";
import { creditedWorkspace } from "./helpers/credit-notes";
import { useMongoDatabase } from "./helpers/mongo";
import { implementNotificationCore } from "./helpers/notification-core";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase();
const stripe = useSuiteStripe();
implementNotificationCore();
const automation = implementAutomationCatalog();
await registerAutomationNodes();

afterEach(() => {
  vi.restoreAllMocks();
});

interface BilledWorkspace {
  tenantId: string;
  customerId: string;
}

async function billedWorkspace(
  status: TenantSubscriptionStatus = "active",
): Promise<BilledWorkspace> {
  const tenantId = randomUUID();
  const customerId = `cus_${randomUUID()}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: "paid",
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: `sub_${tenantId}`,
  });
  return { tenantId, customerId };
}

function invoicePaid(
  customerId: string,
  amountPaid: number,
): Stripe.InvoicePaidEvent {
  return fromPartial<Stripe.InvoicePaidEvent>({
    id: `evt_${randomUUID()}`,
    type: "invoice.paid",
    data: {
      object: {
        id: `in_${randomUUID()}`,
        customer: customerId,
        number: "INV-0007",
        amount_due: amountPaid,
        amount_paid: amountPaid,
        subtotal: amountPaid,
        total_taxes: [],
        total: amountPaid,
        currency: "eur",
        status: "paid",
        billing_reason: "subscription_cycle",
        hosted_invoice_url: "https://invoice.stripe.test/i/7",
        status_transitions: { paid_at: 1_790_000_000 },
        metadata: {},
        created: 1_790_000_000,
        period_start: 1_790_000_000,
        period_end: 1_792_592_000,
        lines: { has_more: false, data: [] },
      },
    },
  });
}

describe("saas.invoice-paid", () => {
  it("fires once with the Stripe event id, also on a redelivery", async () => {
    const workspace = await billedWorkspace();
    const payloads = await armTrigger(automation, "saas.invoice-paid");
    const event = invoicePaid(workspace.customerId, 2_900);

    await dispatchStripeWebhookEvent(event);
    await dispatchStripeWebhookEvent(event);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: workspace.tenantId,
        deliveryId: event.id,
        invoiceNumber: "INV-0007",
        amountPaid: 2_900,
        currency: "eur",
        billingReason: "subscription_cycle",
        hostedInvoiceUrl: "https://invoice.stripe.test/i/7",
        reactivated: false,
      }),
    ]);
  });

  it("skips an invoice with nothing paid unless includeZeroAmount", async () => {
    const workspace = await billedWorkspace();
    const byDefault = await armTrigger(automation, "saas.invoice-paid");
    const withZero = await armTrigger(automation, "saas.invoice-paid", {
      includeZeroAmount: true,
    });

    await dispatchStripeWebhookEvent(invoicePaid(workspace.customerId, 0));

    expect(byDefault).toEqual([]);
    expect(withZero).toHaveLength(1);
  });

  it("reports a payment that lifted a past due workspace", async () => {
    const workspace = await billedWorkspace("past_due");
    const payloads = await armTrigger(automation, "saas.invoice-paid");

    await dispatchStripeWebhookEvent(invoicePaid(workspace.customerId, 2_900));

    expect(payloads).toEqual([expect.objectContaining({ reactivated: true })]);
  });

  it("does not fire for a customer no workspace bills", async () => {
    const payloads = await armTrigger(automation, "saas.invoice-paid");

    await dispatchStripeWebhookEvent(invoicePaid("cus_unknown", 2_900));

    expect(payloads).toEqual([]);
  });
});

describe("saas.credit-note-issued", () => {
  it("fires once for an issued credit note, also on a redelivery", async () => {
    const workspace = await creditedWorkspace();
    vi.spyOn(stripe.write.creditNotes, "retrieve").mockResolvedValue(
      fromPartial(workspace.creditNote),
    );
    const payloads = await armTrigger(automation, "saas.credit-note-issued");

    await dispatchStripeWebhookEvent(workspace.event);
    await dispatchStripeWebhookEvent(workspace.event);

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: workspace.tenantId,
        deliveryId: workspace.event.id,
        creditNoteId: workspace.creditNote.id,
        number: "CN-0042-1",
        invoiceNumber: "INV-0042",
        amount: 3_600,
        currency: "eur",
        type: "post_payment",
        reason: "order_change",
        refundId: null,
      }),
    ]);
  });

  it("does not fire for a stale issue arriving after the void was mirrored", async () => {
    const workspace = await creditedWorkspace();
    const retrieve = vi.spyOn(stripe.write.creditNotes, "retrieve");
    retrieve.mockResolvedValueOnce(
      fromPartial({ ...workspace.creditNote, status: "void" }),
    );
    retrieve.mockResolvedValueOnce(fromPartial(workspace.creditNote));
    const payloads = await armTrigger(automation, "saas.credit-note-issued");

    await dispatchStripeWebhookEvent(
      fromPartial<Stripe.CreditNoteVoidedEvent>({
        id: `evt_${randomUUID()}`,
        type: "credit_note.voided",
        data: {
          object: {
            id: workspace.creditNote.id,
            customer: workspace.creditNote.customer,
          },
        },
      }),
    );
    await dispatchStripeWebhookEvent(workspace.event);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(payloads).toEqual([]);
  });

  it("does not fire for a customer no workspace bills", async () => {
    const workspace = await creditedWorkspace();
    const retrieve = vi.spyOn(stripe.write.creditNotes, "retrieve");
    const payloads = await armTrigger(automation, "saas.credit-note-issued");

    await dispatchStripeWebhookEvent(
      fromPartial<Stripe.Event>({
        id: `evt_${randomUUID()}`,
        type: "credit_note.created",
        data: {
          object: { id: workspace.creditNote.id, customer: "cus_unknown" },
        },
      }),
    );

    expect(retrieve).not.toHaveBeenCalled();
    expect(payloads).toEqual([]);
  });

  it("does not fire for a void credit note", async () => {
    const workspace = await creditedWorkspace();
    vi.spyOn(stripe.write.creditNotes, "retrieve").mockResolvedValue(
      fromPartial({ ...workspace.creditNote, status: "void" }),
    );
    const payloads = await armTrigger(automation, "saas.credit-note-issued");

    await dispatchStripeWebhookEvent(workspace.event);

    expect(payloads).toEqual([]);
  });
});

describe("saas.refund-updated", () => {
  let refundId = "";

  beforeEach(() => {
    refundId = `re_${randomUUID()}`;
  });

  function refundUpdated(
    status: Stripe.Refund["status"],
  ): Stripe.ChargeRefundUpdatedEvent {
    return fromPartial<Stripe.ChargeRefundUpdatedEvent>({
      id: `evt_${randomUUID()}`,
      type: "charge.refund.updated",
      created: 1_790_000_100,
      data: {
        object: {
          id: refundId,
          charge: "ch_1",
          amount: 1_200,
          currency: "eur",
          status,
          failure_reason: fromAny<string | undefined, null>(
            status === "failed" ? "expired_or_canceled_card" : null,
          ),
        },
      },
    });
  }

  function chargeOf(customerId: string) {
    vi.spyOn(stripe.write.charges, "retrieve").mockResolvedValue(
      fromPartial({ id: "ch_1", customer: customerId }),
    );
  }

  it("fires for a succeeded and a failed refund, once each", async () => {
    const workspace = await billedWorkspace();
    chargeOf(workspace.customerId);
    const payloads = await armTrigger(automation, "saas.refund-updated");
    const succeeded = refundUpdated("succeeded");

    await dispatchStripeWebhookEvent(succeeded);
    await dispatchStripeWebhookEvent(succeeded);
    await dispatchStripeWebhookEvent(refundUpdated("failed"));

    expect(payloads).toEqual([
      expect.objectContaining({
        tenantId: workspace.tenantId,
        deliveryId: succeeded.id,
        refundId,
        status: "succeeded",
        amount: 1_200,
        chargeId: "ch_1",
        creditNoteId: null,
        failureReason: null,
        at: new Date(1_790_000_100_000).toISOString(),
      }),
      expect.objectContaining({
        status: "failed",
        failureReason: "expired_or_canceled_card",
      }),
    ]);
  });

  it("fires only for the configured status", async () => {
    const workspace = await billedWorkspace();
    chargeOf(workspace.customerId);
    const payloads = await armTrigger(automation, "saas.refund-updated", {
      status: "failed",
    });

    await dispatchStripeWebhookEvent(refundUpdated("succeeded"));
    await dispatchStripeWebhookEvent(refundUpdated("failed"));

    expect(payloads).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("does not fire for a charge no workspace bills", async () => {
    chargeOf("cus_unknown");
    const payloads = await armTrigger(automation, "saas.refund-updated");

    await dispatchStripeWebhookEvent(refundUpdated("succeeded"));

    expect(payloads).toEqual([]);
  });
});
