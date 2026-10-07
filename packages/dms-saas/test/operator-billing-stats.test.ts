import { describe, expect, it } from "vitest";
import {
  type BillingStat,
  computeCreditNoteStats,
  computeInvoiceStats,
  CREDIT_NOTE_METADATA,
  startOfMonth,
  startOfYear,
  totalsByCurrency,
} from "../src/operator-billing";

const eur = (amount: number) => ({ amount, currency: "eur" });

function stat(items: BillingStat[], id: string): BillingStat | undefined {
  return items.find((item) => item.id === id);
}

describe("billing figures", () => {
  it("sums per currency, the largest first", () => {
    expect(
      totalsByCurrency([
        eur(1_000),
        { amount: 294_000, currency: "USD" },
        eur(2_000),
      ]),
    ).toEqual([
      { amount: 294_000, currency: "usd" },
      { amount: 3_000, currency: "eur" },
    ]);
  });

  it("writes an empty total as a zero with a currency", () => {
    expect(totalsByCurrency([])).toEqual([{ amount: 0, currency: "eur" }]);
  });

  it("counts what open invoices still ask and the retries scheduled", () => {
    const { items } = computeInvoiceStats({
      open: [
        { ...eur(49_000), amountPaid: 0, nextPaymentAttemptAt: new Date() },
        { ...eur(15_000), amountPaid: 5_000, nextPaymentAttemptAt: null },
      ],
      paidThisMonth: [],
      creditNotesThisMonth: [],
      writtenOffThisYear: [],
    });

    expect(stat(items, "awaiting")).toMatchObject({
      value: [eur(59_000)],
      detail: { params: { count: 2, retries: 1 } },
    });
  });

  it("reads what was collected, credited and written off", () => {
    const { items } = computeInvoiceStats({
      open: [],
      paidThisMonth: [{ ...eur(112_700), amountPaid: 112_700 }, eur(900)],
      creditNotesThisMonth: [
        { ...eur(4_900), type: "credit_to_balance", status: "issued" },
        { ...eur(2_000), type: "refund", status: "issued", refundId: "re_1" },
        { ...eur(900), type: "refund", status: "void", refundId: "re_2" },
      ],
      writtenOffThisYear: [eur(2_900)],
    });

    expect(stat(items, "collected")?.value).toEqual([eur(113_600)]);
    expect(stat(items, "credited")).toMatchObject({
      value: [eur(6_900)],
      detail: { params: { count: 2, refunded: [eur(2_000)] } },
    });
    expect(stat(items, "written_off")).toMatchObject({
      value: [eur(2_900)],
      detail: { params: { count: 1 } },
    });
  });

  it("splits this month's credit notes between balance, refunds and voids", () => {
    const { items } = computeCreditNoteStats([
      { ...eur(4_900), type: "credit_to_balance", status: "issued" },
      {
        ...eur(15_000),
        type: "refund",
        status: "issued",
        refundId: "re_1",
        metadata: {},
      },
      {
        ...eur(3_000),
        type: "refund",
        status: "issued",
        refundId: "re_2",
        metadata: { [CREDIT_NOTE_METADATA.issuedBy]: "user_1" },
      },
      { ...eur(900), type: "credit_to_balance", status: "void" },
    ]);

    expect(stat(items, "credited")).toMatchObject({
      value: [eur(22_900)],
      detail: { params: { balance: [eur(4_900)], refunded: [eur(18_000)] } },
    });
    expect(stat(items, "refunded")).toMatchObject({
      value: [eur(18_000)],
      detail: { params: { count: 2, automatic: 1 } },
    });
    expect(stat(items, "count")).toMatchObject({
      value: 4,
      detail: { params: { void: 1 } },
    });
  });

  it("starts the month and the year in UTC", () => {
    const now = new Date("2026-10-07T15:00:00Z");

    expect(startOfMonth(now)).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(startOfYear(now)).toEqual(new Date("2026-01-01T00:00:00Z"));
  });
});
