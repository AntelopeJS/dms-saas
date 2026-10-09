import { HTTPResult } from "@antelopejs/interface-api";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Invoice,
  InvoiceModel,
  Plan,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import type { User } from "@antelopejs/interface-dms/auth/db";

const harness = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  updateSubscription: vi.fn(),
  payInvoice: vi.fn(),
  retrieveInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  clearPending: vi.fn(),
  setCancelAtPeriodEnd: vi.fn(),
  recompute: vi.fn(),
  occupiedSeats: 6,
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn(), Warn: vi.fn(), Info: vi.fn() },
}));
vi.mock("../src/billing-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/billing-state")>()),
  recomputeTenantBillingState: (...args: unknown[]) =>
    harness.recompute(...args),
}));
vi.mock("../src/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plans")>()),
  countOccupiedSeats: async () => harness.occupiedSeats,
  syncStripeSeatQuantity: vi.fn(),
}));
vi.mock("../src/workers", () => ({ applyPlanDowngradeCleanup: vi.fn() }));
vi.mock("../src/plan-changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plan-changes")>()),
  clearPendingPlanChange: (...args: unknown[]) => harness.clearPending(...args),
}));
vi.mock("../src/stripe/plan-schedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/plan-schedule")>()),
  setSubscriptionCancelAtPeriodEnd: (...args: unknown[]) =>
    harness.setCancelAtPeriodEnd(...args),
}));
vi.mock("../src/stripe/client", () => ({
  isStripeConfigured: () => true,
  getStripeClient: () => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => harness.retrieveSubscription(...args),
      update: (...args: unknown[]) => harness.updateSubscription(...args),
    },
    invoices: {
      pay: (...args: unknown[]) => harness.payInvoice(...args),
      retrieve: (...args: unknown[]) => harness.retrieveInvoice(...args),
      voidInvoice: (...args: unknown[]) => harness.voidInvoice(...args),
    },
  }),
}));

import { readScheduledCancellation } from "../src/stripe/subscription-cancellation";
import {
  isPayableInvoice,
  SaasBillingPayInvoiceController,
  toPaymentFailure,
} from "../src/routes/tenant/billing-pay-invoice";
import {
  firstChargedInvoice,
  toEligibilityResponse,
} from "../src/routes/tenant/billing-self-refund";
import { applyOwnerUpgrade } from "../src/routes/tenant/tenant-plan-ops";
import { SaasTenantPlanCancellationController } from "../src/routes/tenant/tenant-plan-cancellation";
import {
  latestPaidInvoice,
  toNextInvoiceRows,
} from "../src/routes/tenant/tenant-upcoming-invoice";
import { LOCALES, missingKeys } from "./helpers/composed-text";

const OWNER = { _id: "owner", email: "owner@example.test" } as User;
const PERIOD_END = new Date("2026-10-31T00:00:00.000Z");
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

const SUBSCRIPTION = {
  _id: "tenant-a",
  planId: "business",
  status: "active",
  isComplimentary: false,
  stripeCustomerId: "cus_a",
  stripeSubscriptionId: "sub_a",
  pendingPlanId: null,
} as TenantSubscription;

const ENTERPRISE = {
  _id: "enterprise",
  billingMode: "seat",
  paymentProviderRefs: { stripePriceId: "price_enterprise" },
} as Plan;

function subscriptionModel(
  subscription: TenantSubscription | undefined = SUBSCRIPTION,
) {
  return {
    findOne: vi.fn(async () => subscription),
    beginTransition: vi.fn(async () => undefined),
    updateDuringTransition: vi.fn(async () => undefined),
    completeTransition: vi.fn(async () => undefined),
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    _id: "inv-row",
    documentType: "invoice",
    stripeInvoiceId: "in_1",
    status: "open",
    total: 49000,
    amount: 49000,
    currency: "eur",
    paidAt: null,
    ...overrides,
  } as Invoice;
}

const context = (tenantId = "tenant-a") =>
  ({ tenantId }) as unknown as Parameters<
    SaasTenantPlanCancellationController["cancelAtPeriodEnd"]
  >[1];

vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => "tenant-a",
}));

beforeEach(() => {
  vi.clearAllMocks();
  harness.occupiedSeats = 6;
  harness.retrieveSubscription.mockResolvedValue({
    items: { data: [{ id: "si_a" }] },
  });
  harness.updateSubscription.mockResolvedValue({});
  harness.setCancelAtPeriodEnd.mockResolvedValue(PERIOD_END);
});

describe("owner upgrade", () => {
  it("charges the difference at once, at the reviewed date, applied once paid", async () => {
    const model = subscriptionModel();
    await applyOwnerUpgrade(
      "tenant-a",
      SUBSCRIPTION,
      ENTERPRISE,
      model as unknown as TenantSubscriptionModel,
      1_790_000_000,
    );

    expect(harness.updateSubscription).toHaveBeenCalledWith(
      "sub_a",
      {
        items: [{ id: "si_a", price: "price_enterprise", quantity: 6 }],
        proration_behavior: "always_invoice",
        proration_date: 1_790_000_000,
        payment_behavior: "pending_if_incomplete",
      },
      expect.anything(),
    );
    expect(model.updateDuringTransition).toHaveBeenCalledWith(
      "tenant-a",
      expect.any(String),
      expect.objectContaining({ planId: "enterprise" }),
    );
    expect(model.completeTransition).toHaveBeenCalledTimes(1);
  });

  function pendingUpgrade(intentStatus: string) {
    harness.updateSubscription.mockResolvedValue({
      pending_update: { expires_at: 1_790_080_000 },
      latest_invoice: "in_upgrade",
    });
    harness.retrieveInvoice.mockResolvedValue({
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
    });
  }

  it("returns the 3D Secure challenge and keeps the plan until it is passed", async () => {
    pendingUpgrade("requires_action");
    const model = subscriptionModel();

    const result = await applyOwnerUpgrade(
      "tenant-a",
      SUBSCRIPTION,
      ENTERPRISE,
      model as unknown as TenantSubscriptionModel,
      undefined,
    );

    expect(result).toMatchObject({
      changed: false,
      planId: "enterprise",
      authentication: { clientSecret: "pi_upgrade_secret" },
    });
    expect(harness.retrieveInvoice).toHaveBeenCalledWith("in_upgrade", {
      expand: ["payments.data.payment.payment_intent"],
    });
    expect(model.updateDuringTransition).not.toHaveBeenCalled();
    expect(model.completeTransition).toHaveBeenCalledTimes(1);
    expect(harness.voidInvoice).not.toHaveBeenCalled();
  });

  it("drops a pending upgrade whose card was declined", async () => {
    pendingUpgrade("requires_payment_method");
    const model = subscriptionModel();

    await expect(
      applyOwnerUpgrade(
        "tenant-a",
        SUBSCRIPTION,
        ENTERPRISE,
        model as unknown as TenantSubscriptionModel,
        undefined,
      ),
    ).rejects.toMatchObject({
      status: 402,
      body: "saas.errors.plan.upgrade_payment_declined",
    });
    expect(harness.voidInvoice).toHaveBeenCalledWith("in_upgrade");
    expect(model.updateDuringTransition).not.toHaveBeenCalled();
    expect(model.completeTransition).toHaveBeenCalledTimes(1);
  });

  it("bills a flat plan once, whatever the seats", async () => {
    await applyOwnerUpgrade(
      "tenant-a",
      SUBSCRIPTION,
      { ...ENTERPRISE, billingMode: "flat" } as Plan,
      subscriptionModel() as unknown as TenantSubscriptionModel,
      undefined,
    );

    expect(harness.updateSubscription.mock.calls[0]?.[1].items).toEqual([
      { id: "si_a", price: "price_enterprise", quantity: 1 },
    ]);
  });

  it("leaves the plan unchanged and releases the change when the card is declined", async () => {
    harness.updateSubscription.mockRejectedValue(
      new Stripe.errors.StripeCardError({
        type: "card_error",
        message: "Your card was declined.",
      }),
    );
    const model = subscriptionModel();

    await expect(
      applyOwnerUpgrade(
        "tenant-a",
        SUBSCRIPTION,
        ENTERPRISE,
        model as unknown as TenantSubscriptionModel,
        undefined,
      ),
    ).rejects.toMatchObject({ status: 402 });
    expect(model.updateDuringTransition).not.toHaveBeenCalled();
    expect(model.completeTransition).toHaveBeenCalledWith(
      "tenant-a",
      expect.any(String),
      {},
    );
  });

  it("keeps the change pending on any other Stripe failure", async () => {
    harness.updateSubscription.mockRejectedValue(new Error("timeout"));
    const model = subscriptionModel();

    await expect(
      applyOwnerUpgrade(
        "tenant-a",
        SUBSCRIPTION,
        ENTERPRISE,
        model as unknown as TenantSubscriptionModel,
        undefined,
      ),
    ).rejects.toThrow("timeout");
    expect(model.completeTransition).not.toHaveBeenCalled();
  });
});

describe("pay invoice", () => {
  const controller = new SaasBillingPayInvoiceController();
  const invoices = (row: Invoice | undefined) =>
    ({ get: async () => row }) as unknown as InvoiceModel;

  it("pays an open invoice only", () => {
    expect(isPayableInvoice(invoice())).toBe(true);
    expect(isPayableInvoice(invoice({ status: "paid" }))).toBe(false);
    expect(isPayableInvoice(invoice({ documentType: "credit_note" }))).toBe(
      false,
    );
    expect(isPayableInvoice(undefined)).toBe(false);
  });

  it("charges the default card for the invoice", async () => {
    harness.payInvoice.mockResolvedValue({ status: "paid" });

    await expect(
      controller.payInvoice(
        OWNER,
        "inv-row",
        invoices(invoice()),
        subscriptionModel() as unknown as TenantSubscriptionModel,
      ),
    ).resolves.toEqual({ status: "paid" });
    expect(harness.payInvoice).toHaveBeenCalledWith("in_1");
  });

  it("refuses an invoice that is no longer open", async () => {
    await expect(
      controller.payInvoice(
        OWNER,
        "inv-row",
        invoices(invoice({ status: "paid" })),
        subscriptionModel() as unknown as TenantSubscriptionModel,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(harness.payInvoice).not.toHaveBeenCalled();
  });

  it("refuses a gifted workspace, which has nothing to pay", async () => {
    await expect(
      controller.payInvoice(
        OWNER,
        "inv-row",
        invoices(invoice()),
        subscriptionModel({
          ...SUBSCRIPTION,
          isComplimentary: true,
        } as TenantSubscription) as unknown as TenantSubscriptionModel,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("tells a declined card from Stripe being unreachable", () => {
    const declined = toPaymentFailure(
      new Stripe.errors.StripeCardError({ type: "card_error" }),
    );
    const refused = toPaymentFailure(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
      }),
    );
    const down = toPaymentFailure(new Error("socket hang up"));

    expect(declined).toBeInstanceOf(HTTPResult);
    expect([declined.status, refused.status, down.status]).toEqual([
      402, 409, 503,
    ]);
  });
});

describe("subscription cancellation", () => {
  const controller = new SaasTenantPlanCancellationController();

  it("cancels at the end of the paid cycle", async () => {
    const model = subscriptionModel();

    await expect(
      controller.cancelAtPeriodEnd(
        OWNER,
        context(),
        model as unknown as TenantSubscriptionModel,
      ),
    ).resolves.toEqual({ cancelAt: PERIOD_END });
    expect(harness.setCancelAtPeriodEnd).toHaveBeenCalledWith("sub_a", true);
    expect(harness.clearPending).toHaveBeenCalled();
    expect(model.completeTransition).toHaveBeenCalled();
  });

  it("waits for an unpaid invoice to be settled", async () => {
    const model = subscriptionModel({
      ...SUBSCRIPTION,
      status: "past_due",
    } as TenantSubscription);

    await expect(
      controller.cancelAtPeriodEnd(
        OWNER,
        context(),
        model as unknown as TenantSubscriptionModel,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(harness.setCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it("keeps the subscription renewing, even while an invoice is unpaid", async () => {
    const model = subscriptionModel({
      ...SUBSCRIPTION,
      status: "past_due",
    } as TenantSubscription);

    await expect(
      controller.keepSubscription(
        OWNER,
        context(),
        model as unknown as TenantSubscriptionModel,
      ),
    ).resolves.toEqual({ cancelAt: null });
    expect(harness.setCancelAtPeriodEnd).toHaveBeenCalledWith("sub_a", false);
  });

  it("has nothing to cancel without a Stripe subscription", async () => {
    await expect(
      controller.cancelAtPeriodEnd(
        OWNER,
        context(),
        subscriptionModel({
          ...SUBSCRIPTION,
          stripeSubscriptionId: null,
        } as TenantSubscription) as unknown as TenantSubscriptionModel,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("reads a cancellation from the cycle end or a cancel date", () => {
    const period = {
      items: { data: [{ current_period_end: seconds(PERIOD_END) }] },
    };
    expect(
      readScheduledCancellation({
        ...period,
        cancel_at_period_end: true,
        cancel_at: null,
      } as unknown as Stripe.Subscription),
    ).toEqual(PERIOD_END);
    expect(
      readScheduledCancellation({
        ...period,
        cancel_at_period_end: false,
        cancel_at: null,
      } as unknown as Stripe.Subscription),
    ).toBeNull();
  });
});

describe("money-back guarantee", () => {
  const firstPayment = seconds(new Date("2026-09-07T00:00:00.000Z"));
  const paidInvoice = {
    id: "in_first",
    amountPaid: 47040,
    created: firstPayment,
    periodStart: null,
    periodEnd: null,
    currency: "eur",
  };

  it("names the amount and when the window closes", () => {
    expect(
      toEligibilityResponse(
        {
          eligible: true,
          reason: null,
          windowDays: 30,
          mode: "full",
          invoice: paidInvoice,
        },
        null,
      ),
    ).toEqual({
      eligible: true,
      reason: null,
      windowDays: 30,
      mode: "full",
      refundAmount: 47040,
      currency: "eur",
      firstPaymentAt: new Date("2026-09-07T00:00:00.000Z"),
      windowEndsAt: new Date("2026-10-07T00:00:00.000Z"),
      refundedAt: null,
    });
  });

  it("starts from the first invoice that took money, not a trial's", () => {
    const paid = (id: string, created: string, amountPaid: number) =>
      ({
        id,
        created: seconds(new Date(created)),
        amount_paid: amountPaid,
      }) as Stripe.Invoice;
    const trial = paid("in_trial", "2026-09-01T00:00:00.000Z", 0);
    const first = paid("in_first", "2026-09-15T00:00:00.000Z", 2900);
    const renewal = paid("in_renewal", "2026-10-15T00:00:00.000Z", 2900);

    expect(firstChargedInvoice([renewal, first, trial])?.id).toBe("in_first");
    expect(firstChargedInvoice([trial])).toBeNull();
  });

  it("says when the window ended, without offering an amount", () => {
    const response = toEligibilityResponse(
      {
        eligible: false,
        reason: "window_expired",
        windowDays: 30,
        mode: "full",
        invoice: paidInvoice,
      },
      null,
    );

    expect(response).toMatchObject({
      reason: "window_expired",
      refundAmount: null,
      windowEndsAt: new Date("2026-10-07T00:00:00.000Z"),
    });
  });
});

describe("next invoice card", () => {
  const preview = {
    status: "available" as const,
    currency: "EUR",
    lines: [
      {
        kind: "subscription" as const,
        description: "10 × Business",
        amountMinorUnits: 49000,
        taxMinorUnits: 9800,
        quantity: 10,
        periodStart: "2026-10-31T00:00:00.000Z",
        periodEnd: "2026-11-30T00:00:00.000Z",
        isProration: false,
        usageLineKey: null,
      },
    ],
    hasMoreLines: false,
    subtotalMinorUnits: 49000,
    totalExcludingTaxMinorUnits: 49000,
    taxMinorUnits: 9800,
    taxes: [
      {
        amountMinorUnits: 9800,
        taxableAmountMinorUnits: 49000,
        isInclusive: false,
        ratePercentage: 20,
        country: "FR",
        taxType: "vat",
        displayName: "VAT",
        jurisdiction: "France",
        taxabilityReason: "standard_rated",
        isReverseCharge: false,
      },
    ],
    taxCountry: "FR",
    isReverseCharge: false,
    totalMinorUnits: 58800,
    amountDueMinorUnits: 58800,
    periodStart: "2026-10-01T00:00:00.000Z",
    periodEnd: "2026-10-31T00:00:00.000Z",
    billingDate: "2026-10-31T00:00:00.000Z",
    usageThrough: null,
    computedAt: "2026-10-07T00:00:00.000Z",
  };

  it("lists the lines, the tax, the total and where the invoice goes", () => {
    const rows = toNextInvoiceRows(preview, {
      paymentMethod: {
        brand: "visa",
        last4: "4242",
        expMonth: 4,
        expYear: 2027,
        holderName: null,
      },
      billingEmail: "billing@acme.test",
      lastPayment: invoice({
        status: "paid",
        total: 47040,
        paidAt: new Date("2026-09-07T00:00:00.000Z"),
      }),
    });

    expect(rows.items.map((row) => [row.label, row.value])).toEqual([
      ["10 × Business", 490],
      ["$saas.tenant_billing.next_invoice.tax", 98],
      ["$saas.tenant_billing.next_invoice.total", 588],
      ["$saas.tenant_billing.next_invoice.charged_to", "Visa •••• 4242"],
      ["$saas.tenant_billing.next_invoice.sent_to", "billing@acme.test"],
      ["$saas.tenant_billing.next_invoice.last_payment", 470.4],
    ]);
    expect(rows.items[1]?.detail).toEqual({
      key: "saas.text.dot_list",
      params: {
        first: { type: "number", value: 0.2, format: "percent" },
        rest: "FR",
      },
    });
    expect(rows.items[0]?.detail).toEqual({
      key: "saas.text.range",
      params: {
        from: {
          type: "date",
          value: "2026-10-31T00:00:00.000Z",
          format: "day",
        },
        to: { type: "date", value: "2026-11-30T00:00:00.000Z", format: "day" },
      },
    });
    for (const code of LOCALES) expect(missingKeys(rows, code)).toEqual([]);
    expect(rows).toMatchObject({
      totalMinorUnits: 58800,
      currency: "EUR",
      billingDate: "2026-10-31T00:00:00.000Z",
    });
  });

  it("picks the most recently paid invoice", () => {
    const older = invoice({
      _id: "a",
      status: "paid",
      paidAt: new Date("2026-08-07T00:00:00.000Z"),
    });
    const newer = invoice({
      _id: "b",
      status: "paid",
      paidAt: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(latestPaidInvoice([older, newer, invoice()])?._id).toBe("b");
    expect(latestPaidInvoice([invoice()])).toBeNull();
  });
});
