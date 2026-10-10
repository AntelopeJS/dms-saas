import type { StatGroupItem } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import {
  computeCreditNoteStats,
  computeInvoiceStats,
  CREDIT_NOTE_METADATA,
  startOfMonth,
  startOfYear,
  totalsByCurrency,
} from "../src/operator-billing";
import { LOCALES, missingKeys } from "./helpers/composed-text";

const eur = (amount: number) => ({ amount, currency: "eur" });
const money = (value: number, currency = "EUR") => ({
  type: "money",
  value,
  currency,
});
const amount = (value: number) => ({
  key: "saas.text.value",
  params: { value: money(value) },
});
const count = (value: number) => ({ type: "count", value });

function stat(items: StatGroupItem[], id: string): StatGroupItem | undefined {
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
      eyebrow: "$saas.operator_billing.stats.awaiting_payment",
      value: amount(59_000),
      detail: { params: { count: count(2), retries: 1 } },
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

    expect(stat(items, "collected")?.value).toEqual(amount(113_600));
    expect(stat(items, "credited")).toMatchObject({
      value: amount(6_900),
      detail: { params: { count: count(2), refunded: money(2_000) } },
    });
    expect(stat(items, "written_off")).toMatchObject({
      value: amount(2_900),
      detail: { params: { count: count(1) } },
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
      value: amount(22_900),
      detail: { params: { balance: money(4_900), refunded: money(18_000) } },
    });
    expect(stat(items, "refunded")).toMatchObject({
      value: amount(18_000),
      detail: { params: { count: count(2), automatic: 1 } },
    });
    expect(stat(items, "count")).toMatchObject({
      value: 4,
      detail: { params: { void: 1 } },
    });
  });

  it("notes the other currencies before the detail", () => {
    const { items } = computeInvoiceStats({
      open: [],
      paidThisMonth: [eur(5_000), { amount: 1_200, currency: "usd" }],
      creditNotesThisMonth: [],
      writtenOffThisYear: [],
    });

    expect(stat(items, "collected")).toMatchObject({
      value: amount(5_000),
      detail: {
        key: "saas.operator_billing.stats.other_currencies",
        params: {
          amounts: money(1_200, "USD"),
          detail: {
            key: "saas.operator_billing.stats.collected_this_month_detail",
          },
        },
      },
    });
  });

  it.each(LOCALES)("%s has every key the figures name", (code) => {
    const notes = [
      { ...eur(4_900), type: "credit_to_balance", status: "issued" },
      {
        amount: 900,
        currency: "usd",
        type: "refund",
        status: "issued",
        refundId: "re_1",
      },
    ];
    const invoiceStats = computeInvoiceStats({
      open: [eur(1), { amount: 2, currency: "usd" }],
      paidThisMonth: [],
      creditNotesThisMonth: notes,
      writtenOffThisYear: [],
    });
    expect(
      missingKeys([invoiceStats, computeCreditNoteStats(notes)], code),
    ).toEqual([]);
  });

  it("starts the month and the year in UTC", () => {
    const now = new Date("2026-10-07T15:00:00Z");

    expect(startOfMonth(now)).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(startOfYear(now)).toEqual(new Date("2026-01-01T00:00:00Z"));
  });
});
