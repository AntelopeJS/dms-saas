import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";
import { injectProvidedInvoiceLineItems } from "../src/invoice-line-items/injection";

const harness = vi.hoisted(() => ({
  subscription: undefined as TenantSubscription | undefined,
  resolve: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@antelopejs/interface-database-decorators", () => ({
  GetModel: () => ({ findOne: async () => harness.subscription }),
}));
vi.mock("../src/db", () => ({ TenantSubscriptionModel: class {} }));
vi.mock("../src/implementations/dms-saas/invoice-line-items", () => ({
  getInvoiceLineItemsProviders: () => [
    { id: "usage", resolve: harness.resolve },
  ],
}));
vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    invoiceItems: { list: harness.list, create: harness.create },
  }),
}));

const INVOICE = {
  id: "invoice",
  subscription: "paid",
  billing_reason: "subscription_cycle",
  status: "draft",
  currency: "eur",
  period_start: 1_000,
  period_end: 2_000,
} as Stripe.Invoice;

beforeEach(() => {
  vi.clearAllMocks();
  harness.subscription = {
    isComplimentary: false,
    paidUsagePeriods: [
      { stripeSubscriptionId: "paid", start: new Date(1_500_000), end: null },
    ],
  } as TenantSubscription;
  harness.resolve.mockResolvedValue([
    { key: "cpu", description: "CPU", amountCents: 123 },
  ]);
  harness.list.mockReturnValue({ autoPagingToArray: async () => [] });
  harness.create.mockResolvedValue({});
});

describe("complimentary invoice provider boundary", () => {
  it("calls the provider and Stripe only with the clipped paid window", async () => {
    await injectProvidedInvoiceLineItems(INVOICE, "tenant", "customer");
    expect(harness.resolve).toHaveBeenCalledWith({
      tenantId: "tenant",
      invoiceId: "invoice",
      currency: "eur",
      periodStart: new Date(1_500_000),
      periodEnd: new Date(2_000_000),
    });
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 123,
        period: { start: 1_500, end: 2_000 },
      }),
      expect.anything(),
    );
  });

  it.each([true, false])(
    "never calls a resolver or Stripe for uncovered gifted/grace windows (marker %s)",
    async (isComplimentary) => {
      harness.subscription = {
        isComplimentary,
        paidUsagePeriods: [],
      } as unknown as TenantSubscription;
      await injectProvidedInvoiceLineItems(INVOICE, "tenant", "customer");
      expect(harness.resolve).not.toHaveBeenCalled();
      expect(harness.list).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
    },
  );
});
