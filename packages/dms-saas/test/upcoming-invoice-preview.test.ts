import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface ModelClass {
  name: string;
}

interface SubscriptionFixture {
  planId?: string | null;
  status?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  isComplimentary?: boolean;
  paidUsagePeriods?: unknown[] | null;
  updatedAt?: Date;
}

interface BillingInfoFixture {
  updatedAt: Date;
}

interface PlanFixture {
  _id: string;
  price: number;
}

const harness = vi.hoisted(() => ({
  subscription: undefined as SubscriptionFixture | undefined,
  billingInfo: undefined as BillingInfoFixture | undefined,
  plans: new Map<string, PlanFixture>(),
  isStripeConfigured: true,
  retrieveSubscription: vi.fn(),
  createPreview: vi.fn(),
  logError: vi.fn(),
  tenantByCustomer: new Map<string, string>(),
  eventHandler: vi.fn(),
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  const fakes: Record<string, unknown> = {
    TenantSubscriptionModel: { findOne: async () => harness.subscription },
    TenantBillingInfoModel: { findOne: async () => harness.billingInfo },
    PlanModel: { get: async (id: string) => harness.plans.get(id) },
  };
  return {
    ...actual,
    GetModel: ((model: ModelClass, ...rest: unknown[]) =>
      fakes[model.name] ??
      (actual.GetModel as (...args: unknown[]) => unknown)(
        model,
        ...rest,
      )) as typeof actual.GetModel,
  };
});

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: {
    Error: (...args: unknown[]) => harness.logError(...args),
    Warn: vi.fn(),
    Info: vi.fn(),
  },
}));

vi.mock("../src/stripe/client", () => ({
  isStripeConfigured: () => harness.isStripeConfigured,
  getStripeClient: () => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => harness.retrieveSubscription(...args),
    },
    invoices: {
      createPreview: (...args: unknown[]) => harness.createPreview(...args),
    },
  }),
}));

vi.mock("../src/stripe/webhook-shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/stripe/webhook-shared")>();
  return {
    ...actual,
    findTenantByCustomerId: async (customerId: string) => {
      const tenantId = harness.tenantByCustomer.get(customerId);
      return tenantId ? { _id: tenantId } : null;
    },
  };
});

vi.mock("../src/stripe/webhook-handlers", () => ({
  handleChargeRefundUpdated: harness.eventHandler,
  handleCustomerUpdated: harness.eventHandler,
  handleInvoiceCreated: harness.eventHandler,
  handleInvoiceFinalized: harness.eventHandler,
  handleInvoicePaid: harness.eventHandler,
  handleInvoicePaymentFailed: harness.eventHandler,
  handleInvoiceVoided: harness.eventHandler,
  handleSubscriptionDeleted: harness.eventHandler,
  handleSubscriptionUpdated: harness.eventHandler,
  handleTrialWillEnd: harness.eventHandler,
}));

import type { InvoiceLineItemsContext } from "@antelopejs/interface-dms-saas/invoice-line-items";
import { setRuntimeConfig } from "../src/config/runtime";
import { internal as lineItemsRegistry } from "../src/implementations/dms-saas/invoice-line-items";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { UpcomingInvoicePreviewCacheModel } from "../src/upcoming-invoice/db/preview-cache.model";
import { getUpcomingInvoicePreview } from "../src/upcoming-invoice/preview";

const SETUP_TIMEOUT_MS = 60_000;
const NOW = new Date("2026-09-15T12:00:00.000Z");
const CYCLE_START = new Date("2026-09-01T00:00:00.000Z");
const CYCLE_END = new Date("2026-10-01T00:00:00.000Z");
const NEXT_CYCLE_END = new Date("2026-11-01T00:00:00.000Z");
const ONE_HOUR_MS = 3_600_000;
const PAID_PLAN: PlanFixture = { _id: "plan-pro", price: 29 };
const FREE_PLAN: PlanFixture = { _id: "plan-free", price: 0 };
const STRIPE_CONFIG = {
  secretKey: "sk_test_dummy",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};

let mongodb: MongoMemoryReplSet;

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function paidSubscription(): SubscriptionFixture {
  return {
    planId: PAID_PLAN._id,
    status: "active",
    stripeCustomerId: "cus_current",
    stripeSubscriptionId: "sub_current",
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

function frenchVat(): Stripe.TaxRate {
  return {
    country: "fr",
    percentage: 20,
    effective_percentage: 20,
    tax_type: "vat",
    display_name: "VAT",
    jurisdiction: "France",
  } as Stripe.TaxRate;
}

function planLine(taxMinorUnits: number): Stripe.InvoiceLineItem {
  return {
    type: "subscription",
    description: "1 × Pro (at €29.00 / month)",
    amount: 2900,
    amount_excluding_tax: 2900,
    tax_amounts: [{ amount: taxMinorUnits }],
    quantity: 1,
    period: { start: seconds(CYCLE_END), end: seconds(NEXT_CYCLE_END) },
    proration: false,
    metadata: {},
  } as unknown as Stripe.InvoiceLineItem;
}

function invoice(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return {
    currency: "eur",
    lines: { data: [planLine(580)], has_more: false },
    subtotal: 2900,
    subtotal_excluding_tax: 2900,
    total_excluding_tax: 2900,
    total: 3480,
    amount_due: 3480,
    total_tax_amounts: [
      {
        amount: 580,
        inclusive: false,
        taxable_amount: 2900,
        taxability_reason: "standard_rated",
        tax_rate: frenchVat(),
      },
    ],
    customer_address: { country: "FR" },
    automatic_tax: { enabled: true, status: "complete" },
    period_start: seconds(CYCLE_START),
    period_end: seconds(CYCLE_END),
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function stripeError(code: string): Error {
  return Object.assign(new Error(`Stripe ${code}`), { code });
}

function webhookEvent(type: string, customer: string): Stripe.Event {
  return {
    id: randomUUID(),
    type,
    data: { object: { object: "invoice", customer } },
  } as unknown as Stripe.Event;
}

function registerProvider(
  id: string,
  resolve: (context: InvoiceLineItemsContext) => unknown,
): void {
  lineItemsRegistry.RegisterInvoiceLineItemsProvider.register(
    id,
    resolve as never,
  );
}

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "upcoming-invoice" });
  await RegisterSchema("dms-core");
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setRuntimeConfig({ stripe: STRIPE_CONFIG });
  harness.subscription = paidSubscription();
  harness.billingInfo = { updatedAt: new Date("2026-08-01T00:00:00.000Z") };
  harness.plans = new Map([
    [PAID_PLAN._id, PAID_PLAN],
    [FREE_PLAN._id, FREE_PLAN],
  ]);
  harness.isStripeConfigured = true;
  harness.tenantByCustomer = new Map();
  harness.retrieveSubscription.mockReset().mockResolvedValue({
    currency: "eur",
    current_period_start: seconds(CYCLE_START),
    current_period_end: seconds(CYCLE_END),
  });
  harness.createPreview.mockReset().mockResolvedValue(invoice());
  harness.logError.mockReset();
  harness.eventHandler.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  lineItemsRegistry.RegisterInvoiceLineItemsProvider.unregister("cloud");
  lineItemsRegistry.RegisterInvoiceLineItemsProvider.unregister("broken");
});

describe("upcoming invoice preview eligibility", () => {
  it.each([
    ["a free plan", { planId: FREE_PLAN._id }, "free_plan"],
    [
      "a complimentary grant on a paid plan",
      { isComplimentary: true },
      "complimentary",
    ],
    ["no plan", { planId: null }, "subscription_not_configured"],
    [
      "no Stripe customer",
      { stripeCustomerId: null },
      "customer_not_configured",
    ],
    [
      "a paid plan awaiting its first payment",
      { status: "pending_payment", stripeSubscriptionId: null },
      "subscription_not_configured",
    ],
  ])(
    "reports %s as absent without calling Stripe",
    async (_label, patch, reason) => {
      harness.subscription = { ...paidSubscription(), ...patch };

      await expect(getUpcomingInvoicePreview(randomUUID())).resolves.toEqual({
        status: "absent",
        reason,
        computedAt: NOW.toISOString(),
      });
      expect(harness.createPreview).not.toHaveBeenCalled();
    },
  );

  it("reports a workspace without subscription as absent", async () => {
    harness.subscription = undefined;

    await expect(
      getUpcomingInvoicePreview(randomUUID()),
    ).resolves.toMatchObject({
      status: "absent",
      reason: "subscription_not_configured",
    });
  });

  it("reports dummy Stripe keys as unavailable", async () => {
    harness.isStripeConfigured = false;

    await expect(
      getUpcomingInvoicePreview(randomUUID()),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "stripe_not_configured",
    });
    expect(harness.createPreview).not.toHaveBeenCalled();
  });
});

describe("upcoming invoice preview pricing", () => {
  it("returns Stripe's figures with the VAT it computed", async () => {
    const preview = await getUpcomingInvoicePreview(randomUUID());

    expect(preview).toEqual({
      status: "available",
      currency: "EUR",
      lines: [
        {
          kind: "subscription",
          description: "1 × Pro (at €29.00 / month)",
          amountMinorUnits: 2900,
          taxMinorUnits: 580,
          quantity: 1,
          periodStart: CYCLE_END.toISOString(),
          periodEnd: NEXT_CYCLE_END.toISOString(),
          isProration: false,
          usageLineKey: null,
        },
      ],
      hasMoreLines: false,
      subtotalMinorUnits: 2900,
      totalExcludingTaxMinorUnits: 2900,
      taxMinorUnits: 580,
      taxes: [
        {
          amountMinorUnits: 580,
          taxableAmountMinorUnits: 2900,
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
      totalMinorUnits: 3480,
      amountDueMinorUnits: 3480,
      periodStart: CYCLE_START.toISOString(),
      periodEnd: CYCLE_END.toISOString(),
      billingDate: CYCLE_END.toISOString(),
      usageThrough: null,
      computedAt: NOW.toISOString(),
    });
    expect(harness.retrieveSubscription).toHaveBeenCalledWith("sub_current");
    expect(harness.createPreview).toHaveBeenCalledWith({
      customer: "cus_current",
      subscription: "sub_current",
      invoice_items: [],
      expand: ["total_tax_amounts.tax_rate"],
    });
  });

  it("flags a reverse-charged business invoice", async () => {
    harness.createPreview.mockResolvedValue(
      invoice({
        lines: { data: [planLine(0)], has_more: false },
        total: 2900,
        amount_due: 2900,
        customer_address: { country: "DE" },
        total_tax_amounts: [
          {
            amount: 0,
            inclusive: false,
            taxable_amount: 0,
            taxability_reason: "reverse_charge",
            tax_rate: {
              ...frenchVat(),
              country: "DE",
              percentage: 0,
              effective_percentage: 0,
            },
          },
        ],
      } as unknown as Partial<Stripe.Invoice>),
    );

    await expect(
      getUpcomingInvoicePreview(randomUUID()),
    ).resolves.toMatchObject({
      status: "available",
      taxMinorUnits: 0,
      totalMinorUnits: 2900,
      taxCountry: "DE",
      isReverseCharge: true,
      taxes: [
        {
          ratePercentage: 0,
          taxabilityReason: "reverse_charge",
          isReverseCharge: true,
        },
      ],
    });
  });

  it("quotes the running cycle's usage so Stripe taxes it with the plan", async () => {
    const resolve = vi.fn(async () => [
      {
        key: "usage-cpu-minutes",
        description: "vCPU allocation",
        amountCents: 1234,
        quantity: 600,
        unit: "vCPU-minute",
      },
    ]);
    registerProvider("cloud", resolve);
    const usageLine = {
      type: "invoiceitem",
      description: "vCPU allocation",
      amount: 1234,
      amount_excluding_tax: 1234,
      tax_amounts: [{ amount: 247 }],
      quantity: 1,
      period: { start: seconds(CYCLE_START), end: seconds(NOW) },
      proration: false,
      metadata: { saasLineKey: "cloud:usage-cpu-minutes" },
    };
    harness.createPreview.mockResolvedValue(
      invoice({
        lines: { data: [planLine(580), usageLine], has_more: false },
      } as unknown as Partial<Stripe.Invoice>),
    );

    const preview = await getUpcomingInvoicePreview(randomUUID());

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "eur",
        periodStart: CYCLE_START,
        periodEnd: NOW,
        isPreview: true,
        invoiceId: "upcoming_sub_current",
      }),
    );
    expect(harness.createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_items: [
          {
            amount: 1234,
            currency: "eur",
            description: "vCPU allocation",
            period: { start: seconds(CYCLE_START), end: seconds(NOW) },
            metadata: {
              saasLineQuantity: "600",
              saasLineUnit: "vCPU-minute",
              saasLineProvider: "cloud",
              saasLineKey: "cloud:usage-cpu-minutes",
            },
          },
        ],
      }),
    );
    expect(preview).toMatchObject({
      status: "available",
      usageThrough: NOW.toISOString(),
      lines: [
        { kind: "subscription" },
        {
          kind: "usage",
          amountMinorUnits: 1234,
          taxMinorUnits: 247,
          usageLineKey: "cloud:usage-cpu-minutes",
        },
      ],
    });
  });

  it("clips quoted usage to the subscription's paid coverage", async () => {
    const paidFrom = new Date("2026-09-10T00:00:00.000Z");
    harness.subscription = {
      ...paidSubscription(),
      paidUsagePeriods: [
        { stripeSubscriptionId: "sub_current", start: paidFrom, end: null },
      ],
    };
    const resolve = vi.fn(async () => []);
    registerProvider("cloud", resolve);

    await getUpcomingInvoicePreview(randomUUID());

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ periodStart: paidFrom, periodEnd: NOW }),
    );
  });

  it.each([
    ["throws", () => Promise.reject(new Error("rollups behind"))],
    [
      "returns an unusable line",
      async () => [{ key: "x", description: "Bad", amountCents: 1.5 }],
    ],
  ])(
    "is unavailable when a usage provider %s rather than under-quoting",
    async (_label, resolve) => {
      registerProvider("broken", resolve);

      await expect(
        getUpcomingInvoicePreview(randomUUID()),
      ).resolves.toMatchObject({
        status: "unavailable",
        reason: "usage_unavailable",
      });
      expect(harness.createPreview).not.toHaveBeenCalled();
      expect(harness.logError).toHaveBeenCalled();
    },
  );

  it.each([
    ["requires_location_inputs", "tax_location_required"],
    ["failed", "tax_calculation_failed"],
  ])(
    "does not present an untaxed total when automatic tax is %s",
    async (status, reason) => {
      harness.createPreview.mockResolvedValue(
        invoice({
          automatic_tax: { enabled: true, status },
        } as unknown as Partial<Stripe.Invoice>),
      );

      await expect(
        getUpcomingInvoicePreview(randomUUID()),
      ).resolves.toMatchObject({ status: "unavailable", reason });
    },
  );
});

describe("upcoming invoice preview Stripe failures", () => {
  it.each([
    ["stripe_tax_inactive", "unavailable", "tax_not_configured"],
    ["customer_tax_location_invalid", "unavailable", "tax_location_invalid"],
    ["taxes_calculation_failed", "unavailable", "tax_calculation_failed"],
    ["rate_limit", "unavailable", "provider_error"],
    ["invoice_upcoming_none", "absent", "no_upcoming_invoice"],
  ])("maps Stripe error %s to %s/%s", async (code, status, reason) => {
    harness.createPreview.mockRejectedValue(stripeError(code));

    await expect(getUpcomingInvoicePreview(randomUUID())).resolves.toEqual({
      status,
      reason,
      computedAt: NOW.toISOString(),
    });
  });

  it("logs a provider outage and never throws to the caller", async () => {
    const outage = new Error("connection reset");
    harness.retrieveSubscription.mockRejectedValue(outage);

    await expect(
      getUpcomingInvoicePreview(randomUUID()),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "provider_error",
    });
    expect(harness.logError).toHaveBeenCalledWith(
      expect.stringContaining("provider_error"),
      outage,
    );
  });

  it("retries an unavailable preview on the next request", async () => {
    const tenantId = randomUUID();
    harness.createPreview.mockRejectedValueOnce(stripeError("rate_limit"));

    await getUpcomingInvoicePreview(tenantId);
    const retried = await getUpcomingInvoicePreview(tenantId);

    expect(retried.status).toBe("available");
    expect(harness.createPreview).toHaveBeenCalledTimes(2);
  });

  it("does not log the expected absence of a next invoice", async () => {
    harness.createPreview.mockRejectedValue(
      stripeError("invoice_upcoming_none"),
    );

    await getUpcomingInvoicePreview(randomUUID());

    expect(harness.logError).not.toHaveBeenCalled();
  });
});

describe("upcoming invoice preview cache", () => {
  it("serves a repeated request from cache", async () => {
    const tenantId = randomUUID();

    const first = await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    const second = await getUpcomingInvoicePreview(tenantId);

    expect(second).toEqual(first);
    expect(harness.createPreview).toHaveBeenCalledOnce();
  });

  it("prices again once the cache lifetime has elapsed", async () => {
    const tenantId = randomUUID();

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + ONE_HOUR_MS + 1));
    const refreshed = await getUpcomingInvoicePreview(tenantId);

    expect(harness.createPreview).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({
      computedAt: new Date(NOW.getTime() + ONE_HOUR_MS + 1).toISOString(),
    });
  });

  it("honors a configured cache lifetime and zero disables it", async () => {
    const tenantId = randomUUID();
    setRuntimeConfig({
      stripe: STRIPE_CONFIG,
      upcomingInvoicePreviewCacheTtlSeconds: 0,
    });

    await getUpcomingInvoicePreview(tenantId);
    await getUpcomingInvoicePreview(tenantId);

    expect(harness.createPreview).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "a plan change",
      () => {
        harness.subscription = {
          ...paidSubscription(),
          planId: "plan-team",
          updatedAt: new Date("2026-09-15T11:59:00.000Z"),
        };
        harness.plans.set("plan-team", { _id: "plan-team", price: 99 });
      },
    ],
    [
      "a billing identity change",
      () => {
        harness.billingInfo = {
          updatedAt: new Date("2026-09-15T11:59:00.000Z"),
        };
      },
    ],
  ])("prices again after %s", async (_label, change) => {
    const tenantId = randomUUID();

    await getUpcomingInvoicePreview(tenantId);
    change();
    await getUpcomingInvoicePreview(tenantId);

    expect(harness.createPreview).toHaveBeenCalledTimes(2);
  });

  it.each([
    "invoice.finalized",
    "invoice.created",
    "customer.subscription.updated",
  ])("prices again after a handled %s webhook", async (type) => {
    const tenantId = randomUUID();
    harness.tenantByCustomer.set("cus_current", tenantId);

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    await dispatchStripeWebhookEvent(webhookEvent(type, "cus_current"));
    await getUpcomingInvoicePreview(tenantId);

    expect(harness.eventHandler).toHaveBeenCalledOnce();
    expect(harness.createPreview).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache on an event that does not change the next invoice", async () => {
    const tenantId = randomUUID();
    harness.tenantByCustomer.set("cus_current", tenantId);

    await getUpcomingInvoicePreview(tenantId);
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    await dispatchStripeWebhookEvent(
      webhookEvent("charge.refund.updated", "cus_current"),
    );
    await getUpcomingInvoicePreview(tenantId);

    expect(harness.createPreview).toHaveBeenCalledOnce();
  });

  it("does not fail a handled webhook when invalidation fails", async () => {
    harness.tenantByCustomer.set("cus_current", randomUUID());
    const invalidate = vi
      .spyOn(UpcomingInvoicePreviewCacheModel.prototype, "invalidate")
      .mockRejectedValue(new Error("database down"));

    await expect(
      dispatchStripeWebhookEvent(webhookEvent("invoice.paid", "cus_current")),
    ).resolves.toBeUndefined();
    expect(harness.logError).toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it("never lets a preview computed before an invalidation win over it", async () => {
    const tenantId = randomUUID();
    const cache = GetModel(UpcomingInvoicePreviewCacheModel);
    const startedAt = new Date(NOW.getTime() - 1000);
    const preview = {
      status: "absent" as const,
      reason: "no_upcoming_invoice" as const,
      computedAt: startedAt.toISOString(),
    };

    await cache.invalidate(tenantId, NOW);
    await cache.store({
      tenantId,
      preview,
      sourceVersion: "v1",
      computedAt: startedAt,
    });

    await expect(
      cache.readFresh({
        tenantId,
        sourceVersion: "v1",
        computedNotBefore: new Date(0),
      }),
    ).resolves.toBeNull();
  });
});

describe("upcoming invoice preview configuration", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects cache lifetime %s",
    (ttl) => {
      expect(() =>
        setRuntimeConfig({
          stripe: STRIPE_CONFIG,
          upcomingInvoicePreviewCacheTtlSeconds: ttl,
        }),
      ).toThrow("upcomingInvoicePreviewCacheTtlSeconds");
    },
  );
});
