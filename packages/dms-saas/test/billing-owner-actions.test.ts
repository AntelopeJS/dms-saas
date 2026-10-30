import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Invoice,
  InvoiceModel,
  type Plan,
  TenantSubscriptionModel,
  type TenantSubscription,
} from "../src/db";
import { readScheduledCancellation } from "../src/stripe/subscription-cancellation";
import {
  isPayableInvoice,
  SaasBillingPayInvoiceController,
} from "../src/routes/tenant/billing-pay-invoice";
import { applyOwnerUpgrade } from "../src/routes/tenant/tenant-plan-ops";
import { SaasTenantPlanCancellationController } from "../src/routes/tenant/tenant-plan-cancellation";
import { useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { insertPlan } from "./helpers/plans";
import { createOwnedWorkspace, seatMembers } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("billing-owner-actions");
useDmsAuth();
const stripe = useSuiteStripe();

const PERIOD_END = new Date("2026-10-31T00:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

let enterprise: Plan;
let enterpriseFlat: Plan;

beforeAll(async () => {
  await insertPlan({ _id: "business", price: 49 });
  enterprise = await insertPlan({
    _id: "enterprise",
    price: 99,
    billingMode: "seat",
    paymentProviderRefs: { stripePriceId: "price_enterprise" },
  });
  enterpriseFlat = await insertPlan({
    _id: "enterprise-flat",
    price: 99,
    paymentProviderRefs: { stripePriceId: "price_enterprise" },
  });
});

function stubStripe() {
  vi.spyOn(stripe.write.subscriptions, "retrieve").mockResolvedValue(
    fromPartial({ items: { data: [{ id: "si_a" }] } }),
  );
  return {
    updateSubscription: vi
      .spyOn(stripe.write.subscriptions, "update")
      .mockResolvedValue(
        fromPartial({
          items: { data: [{ current_period_end: seconds(PERIOD_END) }] },
        }),
      ),
    payInvoice: vi.spyOn(stripe.write.invoices, "pay"),
    retrieveInvoice: vi.spyOn(stripe.write.invoices, "retrieve"),
    voidInvoice: vi.spyOn(stripe.write.invoices, "voidInvoice"),
  };
}

let api: ReturnType<typeof stubStripe>;

beforeEach(() => {
  api = stubStripe();
});

async function seedWorkspace(patch: Partial<TenantSubscription> = {}) {
  const workspace = await createOwnedWorkspace();
  const model = GetModel(TenantSubscriptionModel, workspace.tenantId);
  await model.insert({
    _id: workspace.tenantId,
    planId: "business",
    status: "active",
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: "cus_a",
    stripeSubscriptionId: "sub_a",
    pendingPlanId: null,
    ...patch,
  });
  return { ...workspace, model };
}

async function upgrade(
  plan: Plan,
  prorationDate?: number,
  patch?: Partial<TenantSubscription>,
) {
  const { tenantId, model } = await seedWorkspace(patch);
  await seatMembers(tenantId, 5);
  const stored = await model.findOne();
  if (!stored) throw new Error("Missing fixture");
  return {
    model,
    outcome: applyOwnerUpgrade(tenantId, stored, plan, model, prorationDate),
  };
}

describe("owner upgrade", () => {
  it("charges the difference at once, at the reviewed date, applied once paid", async () => {
    const { model, outcome } = await upgrade(enterprise, 1_790_000_000);
    await outcome;

    expect(api.updateSubscription).toHaveBeenCalledWith(
      "sub_a",
      {
        items: [{ id: "si_a", price: "price_enterprise", quantity: 6 }],
        proration_behavior: "always_invoice",
        proration_date: 1_790_000_000,
        payment_behavior: "pending_if_incomplete",
      },
      expect.anything(),
    );
    expect(api.updateSubscription).toHaveBeenCalledWith(
      "sub_a",
      {
        items: [{ id: "si_a", quantity: 6 }],
        proration_behavior: "create_prorations",
      },
      expect.anything(),
    );
    expect(await model.findOne()).toMatchObject({
      planId: "enterprise",
      domainTransition: null,
    });
  });

  function pendingUpgrade(intentStatus: string) {
    api.updateSubscription.mockResolvedValue(
      fromPartial({
        pending_update: { expires_at: 1_790_080_000 },
        latest_invoice: "in_upgrade",
      }),
    );
    api.retrieveInvoice.mockResolvedValue(
      fromPartial({
        payments: {
          data: [
            {
              payment: {
                payment_intent: {
                  status: intentStatus,
                  client_secret: "pi_upgrade_secret",
                },
              },
            },
          ],
        },
      }),
    );
    api.voidInvoice.mockResolvedValue(fromPartial({}));
  }

  it("returns the 3D Secure challenge and keeps the plan until it is passed", async () => {
    pendingUpgrade("requires_action");

    const { model, outcome } = await upgrade(enterprise);

    await expect(outcome).resolves.toMatchObject({
      changed: false,
      planId: "enterprise",
      authentication: { clientSecret: "pi_upgrade_secret" },
    });
    expect(api.retrieveInvoice).toHaveBeenCalledWith("in_upgrade", {
      expand: ["payments.data.payment.payment_intent"],
    });
    expect(await model.findOne()).toMatchObject({
      planId: "business",
      domainTransition: null,
    });
    expect(api.voidInvoice).not.toHaveBeenCalled();
  });

  it("drops a pending upgrade whose card was declined", async () => {
    pendingUpgrade("requires_payment_method");

    const { model, outcome } = await upgrade(enterprise);

    await expect(outcome).rejects.toMatchObject({
      status: 402,
      body: "saas.errors.plan.upgrade_payment_declined",
    });
    expect(api.voidInvoice).toHaveBeenCalledWith("in_upgrade");
    expect(await model.findOne()).toMatchObject({
      planId: "business",
      domainTransition: null,
    });
  });

  it("bills a flat plan once, whatever the seats", async () => {
    const { outcome } = await upgrade(enterpriseFlat);
    await outcome;

    expect(api.updateSubscription.mock.calls[0]?.[1]?.items).toEqual([
      { id: "si_a", price: "price_enterprise", quantity: 1 },
    ]);
  });

  it("leaves the plan unchanged and releases the change when the card is declined", async () => {
    api.updateSubscription.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: "card_error",
        message: "Your card was declined.",
      }),
    );

    const { model, outcome } = await upgrade(enterprise);

    await expect(outcome).rejects.toMatchObject({ status: 402 });
    expect(await model.findOne()).toMatchObject({
      planId: "business",
      domainTransition: null,
    });
  });

  it("keeps the change pending on any other Stripe failure", async () => {
    api.updateSubscription.mockRejectedValue(new Error("timeout"));

    const { model, outcome } = await upgrade(enterprise);

    await expect(outcome).rejects.toThrow("timeout");
    expect(await model.findOne()).toMatchObject({
      planId: "business",
      domainTransition: { kind: "change_plan", targetPlanId: "enterprise" },
    });
  });
});

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return fromPartial<Invoice>({
    _id: "inv-row",
    documentType: "invoice",
    stripeInvoiceId: "in_1",
    status: "open",
    total: 49000,
    amount: 49000,
    currency: "eur",
    paidAt: null,
    ...overrides,
  });
}

describe("pay invoice", () => {
  const controller = new SaasBillingPayInvoiceController();

  async function pay(
    overrides: Partial<Invoice> = {},
    patch: Partial<TenantSubscription> = {},
  ) {
    const { tenantId, owner } = await seedWorkspace(patch);
    const row = invoice({ _id: randomUUID(), ...overrides });
    await GetModel(InvoiceModel, tenantId).insert(row);
    return controller.payInvoice(
      owner,
      row._id,
      GetModel(InvoiceModel, tenantId),
      GetModel(TenantSubscriptionModel, tenantId),
    );
  }

  it("pays an open invoice only", () => {
    expect(isPayableInvoice(invoice())).toBe(true);
    expect(isPayableInvoice(invoice({ status: "paid" }))).toBe(false);
    expect(isPayableInvoice(invoice({ documentType: "credit_note" }))).toBe(
      false,
    );
    expect(isPayableInvoice(undefined)).toBe(false);
  });

  it("charges the default card for the invoice", async () => {
    api.payInvoice.mockResolvedValue(fromPartial({ status: "paid" }));

    await expect(pay()).resolves.toEqual({ status: "paid" });
    expect(api.payInvoice).toHaveBeenCalledWith("in_1");
  });

  it("refuses an invoice that is no longer open", async () => {
    await expect(pay({ status: "paid" })).rejects.toMatchObject({
      status: 409,
    });
    expect(api.payInvoice).not.toHaveBeenCalled();
  });

  it("refuses a gifted workspace, which has nothing to pay", async () => {
    await expect(pay({}, { isComplimentary: true })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("tells a declined card from Stripe being unreachable", async () => {
    const statusOf = async (failure: Error): Promise<number> => {
      api.payInvoice.mockRejectedValueOnce(failure);
      const refusal = await pay().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(HTTPResult);
      return refusal instanceof HTTPResult ? refusal.status : 0;
    };

    expect([
      await statusOf(new Stripe.errors.StripeCardError({ type: "card_error" })),
      await statusOf(
        new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
        }),
      ),
      await statusOf(new Error("socket hang up")),
    ]).toEqual([402, 409, 503]);
  });
});

describe("subscription cancellation", () => {
  const controller = new SaasTenantPlanCancellationController();

  async function cancellation(patch: Partial<TenantSubscription> = {}) {
    const { owner, request, model, tenantId } = await seedWorkspace(patch);
    return {
      model,
      tenantId,
      cancel: () => controller.cancelAtPeriodEnd(owner, request, model),
      keep: () => controller.keepSubscription(owner, request, model),
    };
  }

  it("cancels at the end of the paid cycle", async () => {
    const { model, cancel } = await cancellation({
      pendingPlanId: "business-lite",
      pendingPlanChangeAt: PERIOD_END,
    });

    await expect(cancel()).resolves.toEqual({ cancelAt: PERIOD_END });
    expect(api.updateSubscription).toHaveBeenCalledWith("sub_a", {
      cancel_at_period_end: true,
    });
    expect(await model.findOne()).toMatchObject({
      pendingPlanId: null,
      domainTransition: null,
    });
  });

  it("waits for an unpaid invoice to be settled", async () => {
    const { cancel } = await cancellation({ status: "past_due" });

    await expect(cancel()).rejects.toMatchObject({ status: 409 });
    expect(api.updateSubscription).not.toHaveBeenCalled();
  });

  it("keeps the subscription renewing, even while an invoice is unpaid", async () => {
    const { keep } = await cancellation({ status: "past_due" });

    await expect(keep()).resolves.toEqual({ cancelAt: null });
    expect(api.updateSubscription).toHaveBeenCalledWith("sub_a", {
      cancel_at_period_end: false,
    });
  });

  it("has nothing to cancel without a Stripe subscription", async () => {
    const { cancel } = await cancellation({ stripeSubscriptionId: null });

    await expect(cancel()).rejects.toMatchObject({ status: 400 });
  });

  it("reads a cancellation from the cycle end or a cancel date", () => {
    const period = {
      items: { data: [{ current_period_end: seconds(PERIOD_END) }] },
    };
    expect(
      readScheduledCancellation(
        fromPartial<Stripe.Subscription>({
          ...period,
          cancel_at_period_end: true,
          cancel_at: null,
        }),
      ),
    ).toEqual(PERIOD_END);
    expect(
      readScheduledCancellation(
        fromPartial<Stripe.Subscription>({
          ...period,
          cancel_at_period_end: false,
          cancel_at: null,
        }),
      ),
    ).toBeNull();
  });
});
