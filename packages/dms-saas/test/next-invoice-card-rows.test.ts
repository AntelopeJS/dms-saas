import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type { Invoice, Plan } from "../src/db";
import {
  latestPaidInvoice,
  planNamesByProduct,
  toNextInvoiceRows,
  withPlanSwitch,
} from "../src/routes/tenant/tenant-upcoming-invoice";
import { LOCALES, missingKeys } from "./helpers/composed-text";

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
        productId: "prod_business",
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
      planNames: new Map(),
    });

    expect(rows.items.map((row) => [row.label, row.value])).toEqual([
      ["10 × Business", 490],
      ["$saas.tenant_billing.next_invoice.tax", 98],
      ["$saas.tenant_billing.next_invoice.total", 588],
      ["$saas.tenant_billing.next_invoice.charged_to", "Visa •••• 4242"],
      ["$saas.tenant_billing.next_invoice.sent_to", "billing@acme.test"],
      ["$saas.tenant_billing.next_invoice.last_payment", 470.4],
    ]);
    expect(rows.items[5]?.detail).toEqual({
      key: "saas.tenant_billing.next_invoice.paid_on",
      params: {
        date: {
          type: "date",
          value: "2026-09-07T00:00:00.000Z",
          format: "medium",
        },
      },
    });
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

  it("words the plan's own line in the reader's language, not Stripe's", () => {
    const proration = {
      ...preview.lines[0]!,
      description: "Remaining time on Business after 1 Oct 2026",
      isProration: true,
    };
    const rows = toNextInvoiceRows(
      { ...preview, lines: [...preview.lines, proration] },
      {
        paymentMethod: null,
        billingEmail: null,
        lastPayment: null,
        planNames: planNamesByProduct([
          fromPartial<Plan>({
            name: "Business",
            paymentProviderRefs: { stripeProductId: "prod_business" },
          }),
          fromPartial<Plan>({
            name: "Off Stripe",
            paymentProviderRefs: {},
          }),
        ]),
      },
    );

    expect(rows.items[0]?.label).toEqual({
      key: "saas.tenant_billing.next_invoice.subscription_line",
      params: { quantity: { type: "number", value: 10 }, plan: "Business" },
    });
    expect(rows.items[1]?.label).toBe(
      "Remaining time on Business after 1 Oct 2026",
    );
    for (const code of LOCALES) expect(missingKeys(rows, code)).toEqual([]);
  });

  it("shows the paid plan's end and the switch to Free when no renewal is coming", () => {
    const rows = withPlanSwitch(
      { items: [], totalMinorUnits: null, currency: null, billingDate: null },
      {
        currentPlanName: "Hobby",
        nextPlanName: "Free",
        isNextPlanFree: true,
        at: new Date("2026-11-19T19:40:19.000Z"),
      },
      {
        paymentMethod: null,
        billingEmail: "billing@acme.test",
        lastPayment: null,
        planNames: new Map(),
      },
    );

    expect(rows.items.map((row) => [row.label, row.value, row.type])).toEqual([
      [
        {
          key: "saas.tenant_billing.next_invoice.paid_until",
          params: { plan: "Hobby" },
        },
        "2026-11-19T19:40:19.000Z",
        "date",
      ],
      [
        {
          key: "saas.tenant_billing.next_invoice.switch_on",
          params: { plan: "Free" },
        },
        "2026-11-19T19:40:19.000Z",
        "date",
      ],
      [
        "$saas.tenant_billing.next_invoice.sent_to",
        "billing@acme.test",
        undefined,
      ],
    ]);
    expect(rows.items[1]?.detail).toEqual({
      key: "saas.tenant_billing.next_invoice.switch_free_detail",
      params: { plan: "Free" },
    });
    expect(rows.billingDate).toBe("2026-11-19T19:40:19.000Z");
    for (const code of LOCALES) expect(missingKeys(rows, code)).toEqual([]);
  });

  it("adds the switch after the total when Stripe still prices an invoice", () => {
    const priced = toNextInvoiceRows(preview, {
      paymentMethod: null,
      billingEmail: null,
      lastPayment: null,
      planNames: new Map(),
    });
    const rows = withPlanSwitch(
      priced,
      {
        currentPlanName: "Business",
        nextPlanName: "Team",
        isNextPlanFree: false,
        at: new Date("2026-10-31T00:00:00.000Z"),
      },
      {
        paymentMethod: null,
        billingEmail: null,
        lastPayment: null,
        planNames: new Map(),
      },
    );

    expect(rows.items.map((row) => row.label)).toEqual([
      ...priced.items.map((row) => row.label),
      {
        key: "saas.tenant_billing.next_invoice.switch_on",
        params: { plan: "Team" },
      },
    ]);
    expect(rows.items.at(-1)?.detail).toBeUndefined();
    expect(rows.totalMinorUnits).toBe(58800);
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
