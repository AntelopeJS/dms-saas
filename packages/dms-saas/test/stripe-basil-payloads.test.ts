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
  it("pins every request to the basil release Managed Payments requires", () => {
    initStripeClient({ secretKey: "sk_test_version", webhookSecret: "whsec" });
    expect(STRIPE_API_VERSION).toBe("2025-08-27.basil");
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
