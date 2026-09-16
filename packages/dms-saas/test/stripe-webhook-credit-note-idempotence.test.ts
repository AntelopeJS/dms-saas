import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ClaimState {
  result: "pending" | "success" | "reconciliation_required";
}

const harness = vi.hoisted(() => ({
  claims: new Map<string, ClaimState>(),
  created: vi.fn<() => Promise<void>>(),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...original,
    GetModel: () => ({
      tryClaim: async (id: string) => {
        const existing = harness.claims.get(id);
        if (existing?.result === "success") return undefined;
        if (existing) throw new Error("Webhook requires reconciliation");
        harness.claims.set(id, { result: "pending" });
        return "admitted-revision";
      },
      markResult: async (
        id: string,
        _revision: string,
        result: ClaimState["result"],
      ) => {
        harness.claims.set(id, { result });
      },
    }),
  };
});

vi.mock("../src/stripe/webhook-credit-notes", () => ({
  handleChargeRefundUpdated: vi.fn(async () => undefined),
  handleCheckoutSessionCompleted: vi.fn(async () => undefined),
  handleCreditNoteCreated: (...args: unknown[]) => harness.created(...args),
  handleCreditNoteVoided: vi.fn(async () => undefined),
  handleCustomerUpdated: vi.fn(async () => undefined),
  handleInvoiceCreated: vi.fn(async () => undefined),
  handleInvoiceFinalized: vi.fn(async () => undefined),
  handleInvoicePaid: vi.fn(async () => undefined),
  handleInvoicePaymentFailed: vi.fn(async () => undefined),
  handleInvoiceVoided: vi.fn(async () => undefined),
  handleSubscriptionDeleted: vi.fn(async () => undefined),
  handleSubscriptionUpdated: vi.fn(async () => undefined),
  handleTrialWillEnd: vi.fn(async () => undefined),
}));

import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";

function event(): Stripe.Event {
  return {
    id: "evt_credit_note_created",
    type: "credit_note.created",
    data: { object: { id: "cn_123" } },
  } as Stripe.Event;
}

beforeEach(() => {
  harness.claims.clear();
  harness.created.mockReset().mockResolvedValue(undefined);
});

describe("credit note webhook event claims", () => {
  it("processes a successful event only once", async () => {
    await dispatchStripeWebhookEvent(event());
    await dispatchStripeWebhookEvent(event());

    expect(harness.created).toHaveBeenCalledOnce();
    expect(harness.claims.get(event().id)?.result).toBe("success");
  });

  it("does not replay a handler whose partial effects are uncertain", async () => {
    harness.created.mockRejectedValueOnce(
      new Error("temporary database outage"),
    );

    await expect(dispatchStripeWebhookEvent(event())).rejects.toThrow(
      "temporary database outage",
    );
    await expect(dispatchStripeWebhookEvent(event())).rejects.toThrow(
      "reconciliation",
    );

    expect(harness.created).toHaveBeenCalledOnce();
    expect(harness.claims.get(event().id)?.result).toBe(
      "reconciliation_required",
    );
  });
});
