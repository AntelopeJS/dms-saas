import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  getStripeClient,
  initStripeClient,
  STRIPE_API_VERSION,
} from "../src/stripe/client";
import {
  readCreditNoteLineTax,
  readCreditNoteRefundId,
  readInvoiceSubscriptionId,
  readInvoiceTax,
  readSubscriptionPeriod,
  readSubscriptionPeriodEnd,
} from "../src/stripe/payload-shapes";
import { toAvailablePreview } from "../src/upcoming-invoice/mapping";

const PERIOD_START = 1_780_000_000;
const PERIOD_END = 1_782_592_000;
const MS_PER_SECOND = 1000;

interface ClientInternals {
  getApiField(key: string): unknown;
}

function subscription(fields: object): Stripe.Subscription {
  return fields as Stripe.Subscription;
}

function invoice(fields: object): Stripe.Invoice {
  return fields as Stripe.Invoice;
}

function creditNote(fields: object): Stripe.CreditNote {
  return fields as Stripe.CreditNote;
}

describe("Stripe API version", () => {
  it("pins every request to the latest dahlia release", () => {
    initStripeClient({ secretKey: "sk_test_version", webhookSecret: "whsec" });
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    expect(
      (getStripeClient() as unknown as ClientInternals).getApiField("version"),
    ).toBe(STRIPE_API_VERSION);
  });
});

describe("subscription billing period", () => {
  it("reads the period from the first subscription item", () => {
    const basil = subscription({
      items: {
        data: [
          {
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });
    expect(readSubscriptionPeriod(basil)).toEqual({
      start: PERIOD_START,
      end: PERIOD_END,
    });
    expect(readSubscriptionPeriodEnd(basil)).toEqual(
      new Date(PERIOD_END * MS_PER_SECOND),
    );
  });

  it("falls back to the subscription fields of a pre-basil webhook", () => {
    const legacy = subscription({
      items: { data: [{}] },
      current_period_start: PERIOD_START,
      current_period_end: PERIOD_END,
    });
    expect(readSubscriptionPeriod(legacy)).toEqual({
      start: PERIOD_START,
      end: PERIOD_END,
    });
  });

  it("reports no period when neither shape carries one", () => {
    expect(readSubscriptionPeriodEnd(subscription({}))).toBeNull();
  });
});

describe("invoice fields", () => {
  it("reads the billed subscription from the invoice parent", () => {
    expect(
      readInvoiceSubscriptionId(
        invoice({
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_basil" },
          },
        }),
      ),
    ).toBe("sub_basil");
    expect(
      readInvoiceSubscriptionId(
        invoice({
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: { id: "sub_expanded" } },
          },
        }),
      ),
    ).toBe("sub_expanded");
  });

  it("falls back to the subscription field of a pre-basil invoice", () => {
    expect(
      readInvoiceSubscriptionId(invoice({ subscription: "sub_old" })),
    ).toBe("sub_old");
    expect(readInvoiceSubscriptionId(invoice({ parent: null }))).toBeNull();
  });

  it("sums total_taxes, or reads the pre-basil tax total", () => {
    expect(
      readInvoiceTax(
        invoice({ total_taxes: [{ amount: 200 }, { amount: 45 }] }),
      ),
    ).toBe(245);
    expect(readInvoiceTax(invoice({ tax: 580 }))).toBe(580);
    expect(readInvoiceTax(invoice({}))).toBe(0);
  });
});

describe("credit note fields", () => {
  it("reads the refund and tax of a basil credit note", () => {
    const note = creditNote({
      refunds: [{ amount_refunded: 1200, refund: "re_basil" }],
      total_taxes: [{ amount: 200 }],
    });
    expect(readCreditNoteRefundId(note)).toBe("re_basil");
    expect(readCreditNoteLineTax(note)).toBe(200);
  });

  it("falls back to the refund and tax amounts of a pre-basil credit note", () => {
    const note = creditNote({
      refund: { id: "re_old" },
      tax_amounts: [{ amount: 100 }, { amount: 20 }],
    });
    expect(readCreditNoteRefundId(note)).toBe("re_old");
    expect(readCreditNoteLineTax(note)).toBe(120);
  });
});

describe("upcoming invoice lines", () => {
  it("maps a prorated line with inclusive tax from its basil parent", () => {
    const line = {
      description: "Remaining time on Pro",
      amount: 1200,
      quantity: 1,
      period: { start: PERIOD_START, end: PERIOD_END },
      metadata: {},
      taxes: [{ amount: 200, tax_behavior: "inclusive" }],
      parent: {
        type: "subscription_item_details",
        invoice_item_details: null,
        subscription_item_details: {
          invoice_item: "ii_proration",
          proration: true,
          subscription: "sub",
          subscription_item: "si",
        },
      },
    };
    const preview = toAvailablePreview(
      {
        invoice: invoice({
          currency: "eur",
          lines: { data: [line], has_more: false },
          subtotal: 1200,
          total: 1200,
          amount_due: 1200,
          total_taxes: [],
          period_start: PERIOD_START,
          period_end: PERIOD_END,
        }),
        taxRates: new Map(),
      },
      { billingDate: new Date(), usageThrough: null, computedAt: new Date() },
    );
    expect(preview.lines[0]).toMatchObject({
      kind: "invoice_item",
      isProration: true,
      amountMinorUnits: 1000,
      taxMinorUnits: 200,
    });
  });
});

// Payloads as a webhook endpoint on 2026-08-26.dahlia renders them: clover and
// dahlia moved none of the fields dms-saas reads, so the basil readers apply
// unchanged, next to the fields those releases added or reshaped.
describe("dahlia webhook payloads", () => {
  const USAGE_THROUGH = new Date("2026-09-15T00:00:00.000Z");

  it("reads the period of a classic-mode subscription with a sourced discount", () => {
    const dahlia = subscription({
      object: "subscription",
      billing_mode: { type: "classic", updated_at: null },
      discounts: ["di_1"],
      discount: {
        id: "di_1",
        source: { type: "coupon", coupon: "co_launch" },
      },
      items: {
        data: [
          {
            billed_until: PERIOD_END,
            current_period_start: PERIOD_START,
            current_period_end: PERIOD_END,
          },
        ],
      },
    });
    expect(readSubscriptionPeriod(dahlia)).toEqual({
      start: PERIOD_START,
      end: PERIOD_END,
    });
  });

  it("reads the subscription, tax and decimal-quantity lines of an invoice", () => {
    const dahlia = invoice({
      object: "invoice",
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_dahlia" },
      },
      total_taxes: [
        {
          amount: 0,
          taxable_amount: 1000,
          tax_behavior: "exclusive",
          taxability_reason: "reverse_charge",
          type: "tax_rate_details",
          tax_rate_details: { tax_rate: "txr_de" },
        },
      ],
    });
    expect(readInvoiceSubscriptionId(dahlia)).toBe("sub_dahlia");
    expect(readInvoiceTax(dahlia)).toBe(0);
  });

  it("reads the refund and tax of a credit note", () => {
    const note = creditNote({
      object: "credit_note",
      type: "post_payment",
      refunds: [
        {
          amount_refunded: 1200,
          refund: "re_dahlia",
          payment_record_refund: null,
          type: "refund",
        },
      ],
      total_taxes: [{ amount: 150, taxability_reason: "standard_rated" }],
    });
    expect(readCreditNoteRefundId(note)).toBe("re_dahlia");
    expect(readCreditNoteLineTax(note)).toBe(150);
  });

  it("previews reverse-charged taxes with their country and usage cutoff", () => {
    const line = {
      description: "Pro",
      amount: 1000,
      quantity: 1,
      quantity_decimal: "1",
      unit_amount_decimal: "1000",
      period: { start: PERIOD_START, end: PERIOD_END },
      metadata: {},
      taxes: [
        {
          amount: 0,
          tax_behavior: "exclusive",
          taxability_reason: "reverse_charge",
          taxable_amount: 1000,
          type: "tax_rate_details",
          tax_rate_details: { tax_rate: "txr_de" },
        },
      ],
      parent: {
        type: "subscription_item_details",
        invoice_item_details: null,
        subscription_item_details: {
          invoice_item: null,
          proration: false,
          subscription: "sub_dahlia",
          subscription_item: "si_dahlia",
        },
      },
    };
    const preview = toAvailablePreview(
      {
        invoice: invoice({
          currency: "eur",
          customer_address: { country: "FR" },
          lines: { data: [line], has_more: false },
          subtotal: 1000,
          subtotal_excluding_tax: 1000,
          total_excluding_tax: 1000,
          total: 1000,
          amount_due: 1000,
          total_taxes: line.taxes,
          period_start: PERIOD_START,
          period_end: PERIOD_END,
        }),
        taxRates: new Map([
          [
            "txr_de",
            {
              id: "txr_de",
              country: "de",
              percentage: 19,
              effective_percentage: 0,
              tax_type: "vat",
              display_name: "VAT",
              jurisdiction: "DE",
            } as Stripe.TaxRate,
          ],
        ]),
      },
      {
        billingDate: new Date(PERIOD_END * MS_PER_SECOND),
        usageThrough: USAGE_THROUGH,
        computedAt: new Date(),
      },
    );
    expect(preview).toMatchObject({
      taxCountry: "DE",
      isReverseCharge: true,
      taxMinorUnits: 0,
      usageThrough: USAGE_THROUGH.toISOString(),
      taxes: [
        {
          country: "DE",
          isReverseCharge: true,
          ratePercentage: 0,
          taxableAmountMinorUnits: 1000,
        },
      ],
    });
    expect(preview.lines[0]).toMatchObject({
      kind: "subscription",
      quantity: 1,
      isProration: false,
    });
  });
});
