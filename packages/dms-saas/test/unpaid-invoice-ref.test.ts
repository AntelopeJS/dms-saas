import { describe, expect, it } from "vitest";
import { toUnpaidInvoiceRef } from "../src/billing-state/recovery";
import type { Invoice } from "../src/db";

const HOSTED_URL = "https://invoice.stripe.com/i/test";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    number: "INV-001",
    amount: 19602,
    total: 19602,
    currency: "eur",
    hostedInvoiceUrl: HOSTED_URL,
    ...overrides,
  } as Invoice;
}

describe("toUnpaidInvoiceRef", () => {
  it("carries what the settlement action needs", () => {
    expect(toUnpaidInvoiceRef(invoice())).toEqual({
      number: "INV-001",
      amount: 19602,
      currency: "eur",
      hostedInvoiceUrl: HOSTED_URL,
    });
  });

  it("falls back to the stored amount when the total was never mirrored", () => {
    expect(toUnpaidInvoiceRef(invoice({ total: 0 })).amount).toBe(19602);
    expect(
      toUnpaidInvoiceRef(invoice({ total: undefined as unknown as number }))
        .amount,
    ).toBe(19602);
  });

  it("prefers the mirrored total over the initial amount", () => {
    expect(toUnpaidInvoiceRef(invoice({ total: 23718 })).amount).toBe(23718);
  });

  it("keeps a missing number and hosted url as null", () => {
    const ref = toUnpaidInvoiceRef(
      invoice({ number: null, hostedInvoiceUrl: null }),
    );

    expect(ref.number).toBeNull();
    expect(ref.hostedInvoiceUrl).toBeNull();
  });
});
