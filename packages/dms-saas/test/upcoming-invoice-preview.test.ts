import { randomUUID } from "node:crypto";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { TenantSubscription } from "../src/db";
import { getUpcomingInvoicePreview } from "../src/upcoming-invoice/preview";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";
import {
  CYCLE_END,
  CYCLE_START,
  exclusiveTax,
  FREE_PLAN_ID,
  FRENCH_VAT_ID,
  GERMAN_REVERSE_CHARGE_ID,
  NEXT_CYCLE_END,
  NOW,
  planLine,
  previewInvoice,
  registerProvider,
  seconds,
  seedPreviewWorkspace,
  SUBSCRIPTION_ID,
  stripeError,
  usePreviewEnvironment,
} from "./helpers/upcoming-invoice";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("upcoming-invoice-preview");
const stripe = useSuiteStripe();
const logs = captureLogs();
const previews = usePreviewEnvironment(stripe);

describe("upcoming invoice preview eligibility", () => {
  it.each<[string, Partial<TenantSubscription>, string]>([
    ["a free plan", { planId: FREE_PLAN_ID }, "free_plan"],
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
      const { tenantId } = await seedPreviewWorkspace(patch);

      await expect(getUpcomingInvoicePreview(tenantId)).resolves.toEqual({
        status: "absent",
        reason,
        computedAt: NOW.toISOString(),
      });
      expect(previews.createPreview).not.toHaveBeenCalled();
    },
  );

  it("reports a workspace without subscription as absent", async () => {
    await expect(
      getUpcomingInvoicePreview(randomUUID()),
    ).resolves.toMatchObject({
      status: "absent",
      reason: "subscription_not_configured",
    });
  });

  it("reports dummy Stripe keys as unavailable", async () => {
    const { tenantId } = await seedPreviewWorkspace();

    await withUnconfiguredStripe(stripe, async (unconfigured) => {
      const createPreview = vi.spyOn(
        unconfigured.read.invoices,
        "createPreview",
      );

      await expect(getUpcomingInvoicePreview(tenantId)).resolves.toMatchObject({
        status: "unavailable",
        reason: "stripe_not_configured",
      });
      expect(createPreview).not.toHaveBeenCalled();
    });
  });
});

describe("upcoming invoice preview pricing", () => {
  it("returns Stripe's figures with the VAT it computed", async () => {
    const { tenantId, customerId } = await seedPreviewWorkspace();

    const preview = await getUpcomingInvoicePreview(tenantId);

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
          productId: "prod_pro",
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
    expect(previews.retrieveSubscription).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(previews.createPreview).toHaveBeenCalledWith({
      customer: customerId,
      subscription: SUBSCRIPTION_ID,
      invoice_items: [],
    });
    expect(previews.retrieveTaxRate).toHaveBeenCalledWith(FRENCH_VAT_ID);
  });

  it("flags a reverse-charged business invoice", async () => {
    const { tenantId } = await seedPreviewWorkspace();
    previews.createPreview.mockResolvedValue(
      fromPartial(
        previewInvoice({
          lines: { data: [planLine(0)], has_more: false },
          total: 2900,
          amount_due: 2900,
          customer_address: { country: "DE" },
          total_taxes: [
            exclusiveTax(0, GERMAN_REVERSE_CHARGE_ID, "reverse_charge"),
          ],
        }),
      ),
    );

    await expect(getUpcomingInvoicePreview(tenantId)).resolves.toMatchObject({
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
    const { tenantId } = await seedPreviewWorkspace();
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
    const usageLine = fromPartial<Stripe.InvoiceLineItem>({
      description: "vCPU allocation",
      amount: 1234,
      taxes: [exclusiveTax(247)],
      quantity: 1,
      period: { start: seconds(CYCLE_START), end: seconds(NOW) },
      parent: {
        type: "invoice_item_details",
        invoice_item_details: {
          invoice_item: "ii_usage",
          proration: false,
          subscription: SUBSCRIPTION_ID,
        },
        subscription_item_details: null,
      },
      metadata: { saasLineKey: "cloud:usage-cpu-minutes" },
    });
    previews.createPreview.mockResolvedValue(
      fromPartial(
        previewInvoice({
          lines: { data: [planLine(580), usageLine], has_more: false },
        }),
      ),
    );

    const preview = await getUpcomingInvoicePreview(tenantId);

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "eur",
        periodStart: CYCLE_START,
        periodEnd: NOW,
        isPreview: true,
        invoiceId: `upcoming_${SUBSCRIPTION_ID}`,
      }),
    );
    expect(previews.createPreview).toHaveBeenCalledWith(
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
    const { tenantId } = await seedPreviewWorkspace({
      paidUsagePeriods: [
        { stripeSubscriptionId: SUBSCRIPTION_ID, start: paidFrom, end: null },
      ],
    });
    const resolve = vi.fn(async () => []);
    registerProvider("cloud", resolve);

    await getUpcomingInvoicePreview(tenantId);

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
      const { tenantId } = await seedPreviewWorkspace();
      registerProvider("broken", resolve);

      await expect(getUpcomingInvoicePreview(tenantId)).resolves.toMatchObject({
        status: "unavailable",
        reason: "usage_unavailable",
      });
      expect(previews.createPreview).not.toHaveBeenCalled();
      expect(logs.at("ERROR")).toContainEqual([
        `[dms-saas:upcoming-invoice] no upcoming invoice preview for tenant ${tenantId} (usage_unavailable)`,
        undefined,
      ]);
    },
  );

  it.each([
    ["requires_location_inputs", "tax_location_required"],
    ["failed", "tax_calculation_failed"],
  ] as const)(
    "does not present an untaxed total when automatic tax is %s",
    async (status, reason) => {
      const { tenantId } = await seedPreviewWorkspace();
      previews.createPreview.mockResolvedValue(
        fromPartial(
          previewInvoice({ automatic_tax: { enabled: true, status } }),
        ),
      );

      await expect(getUpcomingInvoicePreview(tenantId)).resolves.toMatchObject({
        status: "unavailable",
        reason,
      });
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
    const { tenantId } = await seedPreviewWorkspace();
    previews.createPreview.mockRejectedValue(stripeError(code));

    await expect(getUpcomingInvoicePreview(tenantId)).resolves.toEqual({
      status,
      reason,
      computedAt: NOW.toISOString(),
    });
  });

  it("logs a provider outage and never throws to the caller", async () => {
    const { tenantId } = await seedPreviewWorkspace();
    const outage = new Error("connection reset");
    previews.retrieveSubscription.mockRejectedValue(outage);

    await expect(getUpcomingInvoicePreview(tenantId)).resolves.toMatchObject({
      status: "unavailable",
      reason: "provider_error",
    });
    expect(logs.at("ERROR")).toContainEqual([
      expect.stringContaining("provider_error"),
      outage,
    ]);
  });

  it("retries an unavailable preview on the next request", async () => {
    const { tenantId } = await seedPreviewWorkspace();
    previews.createPreview.mockRejectedValueOnce(stripeError("rate_limit"));

    await getUpcomingInvoicePreview(tenantId);
    const retried = await getUpcomingInvoicePreview(tenantId);

    expect(retried.status).toBe("available");
    expect(previews.createPreview).toHaveBeenCalledTimes(2);
  });

  it("does not log the expected absence of a next invoice", async () => {
    const { tenantId } = await seedPreviewWorkspace();
    previews.createPreview.mockRejectedValue(
      stripeError("invoice_upcoming_none"),
    );

    await getUpcomingInvoicePreview(tenantId);

    expect(logs.at("ERROR")).toEqual([]);
  });
});
