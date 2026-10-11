import { describe, expect, it } from "vitest";
import {
  buildCreditNoteParams,
  CREDIT_NOTE_METADATA,
  creditAllowance,
  issueCreditNoteBodySchema,
  sumIssuedCredits,
} from "../src/operator-billing";

const TOTAL = 112_700;
const ISSUER = { _id: "user_1", name: "Camille Laurent", email: "c@x.test" };

function body(overrides: Record<string, unknown> = {}) {
  return issueCreditNoteBodySchema.parse({
    invoiceId: "in_row",
    amount: 21_240,
    mode: "credit_to_balance",
    reason: "service_issue",
    memo: "Goodwill for the outage",
    requestId: "req_1",
    ...overrides,
  });
}

describe("credit allowance", () => {
  it("leaves the total less what was credited on a paid invoice", () => {
    expect(creditAllowance({ status: "paid", total: TOTAL }, 4_900)).toEqual({
      credited: 4_900,
      creditable: 107_800,
      modes: ["credit_to_balance", "refund"],
      blockReason: null,
    });
  });

  it("credits an open invoice by lowering what it asks", () => {
    expect(creditAllowance({ status: "open", total: TOTAL }, 0).modes).toEqual([
      "reduce_amount_due",
    ]);
  });

  it.each([
    ["draft", "draft"],
    ["void", "void"],
    ["uncollectible", "uncollectible"],
  ])("refuses a %s invoice with its reason", (status, reason) => {
    expect(creditAllowance({ status, total: TOTAL }, 0)).toEqual({
      credited: 0,
      creditable: 0,
      modes: [],
      blockReason: reason,
    });
  });

  it("refuses an invoice already credited in full", () => {
    expect(
      creditAllowance({ status: "paid", total: TOTAL }, TOTAL).blockReason,
    ).toBe("fully_credited");
  });

  it("counts issued credit notes only", () => {
    expect(
      sumIssuedCredits([
        { amount: 4_900, status: "issued" },
        { amount: 900, status: "void" },
        { amount: 100, status: "issued" },
      ]),
    ).toBe(5_000);
  });
});

describe("credit note request", () => {
  it("credits the balance with the whole amount", () => {
    const params = buildCreditNoteParams("in_1", body(), ISSUER);

    expect(params).toMatchObject({
      invoice: "in_1",
      amount: 21_240,
      credit_amount: 21_240,
      reason: "product_unsatisfactory",
    });
    expect(params.refund_amount).toBeUndefined();
  });

  it("refunds the card with the whole amount", () => {
    const params = buildCreditNoteParams(
      "in_1",
      body({ mode: "refund" }),
      ISSUER,
    );

    expect(params.refund_amount).toBe(21_240);
    expect(params.credit_amount).toBeUndefined();
  });

  it("only lowers the amount due of an open invoice", () => {
    const params = buildCreditNoteParams(
      "in_1",
      body({ mode: "reduce_amount_due", reason: "goodwill" }),
      ISSUER,
    );

    expect(params.credit_amount).toBeUndefined();
    expect(params.refund_amount).toBeUndefined();
    expect(params.reason).toBeUndefined();
  });

  it("records who issued it, why, and the memo the customer never sees", () => {
    const params = buildCreditNoteParams("in_1", body(), ISSUER);

    expect(params.metadata).toEqual({
      [CREDIT_NOTE_METADATA.issuedBy]: "user_1",
      [CREDIT_NOTE_METADATA.issuedByName]: "Camille Laurent",
      [CREDIT_NOTE_METADATA.reason]: "service_issue",
      [CREDIT_NOTE_METADATA.internalMemo]: "Goodwill for the outage",
    });
    expect(params.memo).toBeUndefined();
  });

  it.each([
    { amount: 0 },
    { amount: -100 },
    { amount: 12.5 },
    { memo: "x".repeat(501) },
    { reason: "because" },
    { mode: "wire" },
  ])("refuses %o", (overrides) => {
    expect(() => body(overrides)).toThrow();
  });
});
