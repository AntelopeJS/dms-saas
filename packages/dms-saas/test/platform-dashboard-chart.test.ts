import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it } from "vitest";
import type { Invoice } from "../src/db";
import { paidInvoicesChart } from "../src/metrics/revenue";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-07T12:00:00Z");
const range = { from: new Date(NOW.getTime() - 29 * DAY_MS), to: NOW };

function document(overrides: Partial<Invoice>): Invoice {
  return fromPartial<Invoice>({
    documentType: "invoice",
    status: "paid",
    currency: "eur",
    total: 1_000,
    amount: 1_000,
    issuedAt: NOW,
    paidAt: NOW,
    ...overrides,
  });
}

describe("paid invoices chart", () => {
  it("draws collected and credited money per day over a month", () => {
    const chart = paidInvoicesChart(
      [
        document({}),
        document({ total: 500, paidAt: new Date(NOW.getTime() - DAY_MS) }),
        document({ documentType: "credit_note", status: "issued", total: 200 }),
        document({ currency: "usd", total: 9_999 }),
        document({ status: "open", total: 7_777 }),
      ],
      range,
      null,
      "EUR",
    );

    expect(chart.value).toBe(15);
    expect(chart.series.map((series) => series.name)).toEqual([
      "$saas.dashboard.paid_invoices.collected",
      "$saas.dashboard.paid_invoices.credited",
    ]);
    expect(chart.series[0]?.data.at(-1)).toEqual({ x: "2026-10-07", y: 10 });
    expect(chart.series[1]?.data.at(-1)).toEqual({ x: "2026-10-07", y: 2 });
  });

  it("draws one bar per month beyond a quarter", () => {
    const chart = paidInvoicesChart(
      [document({})],
      { from: new Date("2026-01-01T00:00:00Z"), to: NOW },
      null,
      "EUR",
    );

    expect(chart.series[0]?.data.map((point) => point.x)).toContain("2026-10");
    expect(chart.series[0]?.data).toHaveLength(10);
  });

  it("compares with the previous period", () => {
    const previous = {
      from: new Date(NOW.getTime() - 59 * DAY_MS),
      to: new Date(NOW.getTime() - 30 * DAY_MS),
    };
    const chart = paidInvoicesChart(
      [
        document({}),
        document({ total: 500, paidAt: new Date(NOW.getTime() - 40 * DAY_MS) }),
      ],
      range,
      previous,
      "EUR",
    );

    expect(chart).toMatchObject({ value: 10, previousValue: 5, delta: 100 });
    expect(chart.comparisonSeries?.[0]?.data).toHaveLength(
      chart.series[0]?.data.length ?? 0,
    );
  });

  it("names the previous period's series and lays it on the current days", () => {
    const previous = {
      from: new Date(NOW.getTime() - 59 * DAY_MS),
      to: new Date(NOW.getTime() - 30 * DAY_MS),
    };
    const chart = paidInvoicesChart(
      [document({ total: 500, paidAt: previous.to })],
      range,
      previous,
      "EUR",
      "previous-period",
    );

    const [comparison] = chart.comparisonSeries ?? [];
    expect(comparison?.name).toBe(
      "$saas.dashboard.paid_invoices.collected_previous_period",
    );
    expect(comparison?.data.at(-1)).toEqual({ x: "2026-10-07", y: 5 });
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "names a custom comparison's series with the custom label when the mode is %s",
    (mode) => {
      const previous = {
        from: new Date(NOW.getTime() - 59 * DAY_MS),
        to: new Date(NOW.getTime() - 30 * DAY_MS),
      };
      const chart = paidInvoicesChart(
        [document({})],
        range,
        previous,
        "EUR",
        mode,
      );

      expect(chart.comparisonSeries?.[0]?.name).toBe(
        "$saas.dashboard.paid_invoices.collected_compared",
      );
    },
  );
});

describe("paid invoices chart", () => {
  it("compares with the same days a year before", () => {
    const lastYear = {
      from: new Date("2025-09-08T12:00:00Z"),
      to: new Date("2025-10-07T12:00:00Z"),
    };
    const chart = paidInvoicesChart(
      [
        document({ total: 3_000 }),
        document({ total: 2_000, paidAt: new Date("2025-10-07T09:00:00Z") }),
        document({ total: 400, paidAt: new Date("2025-09-08T13:00:00Z") }),
        document({ total: 9_000, paidAt: new Date("2026-03-01T00:00:00Z") }),
      ],
      range,
      lastYear,
      "EUR",
      "previous-year",
    );

    expect(chart).toMatchObject({ value: 30, previousValue: 24, delta: 25 });
    const [comparison] = chart.comparisonSeries ?? [];
    expect(comparison?.name).toBe(
      "$saas.dashboard.paid_invoices.collected_previous_year",
    );
    expect(comparison?.data[0]).toEqual({ x: "2026-09-08", y: 4 });
    expect(comparison?.data.at(-1)).toEqual({ x: "2026-10-07", y: 20 });
  });

  it("compares a year to date month by month with the year before", () => {
    const chart = paidInvoicesChart(
      [
        document({}),
        document({ total: 800, paidAt: new Date("2025-02-10T00:00:00Z") }),
      ],
      { from: new Date("2026-01-01T00:00:00Z"), to: NOW },
      {
        from: new Date("2025-01-01T00:00:00Z"),
        to: new Date("2025-10-07T12:00:00Z"),
      },
      "EUR",
      "previous-year",
    );

    const [comparison] = chart.comparisonSeries ?? [];
    expect(comparison?.data[1]).toEqual({ x: "2026-02", y: 8 });
    expect(comparison?.data).toHaveLength(10);
  });

  it("shows no change and no comparison series without a comparison", () => {
    const { series, ...figures } = paidInvoicesChart(
      [document({})],
      range,
      null,
      "EUR",
    );

    expect(figures).toEqual({ value: 10 });
    expect(series).toEqual(expect.any(Array));
  });
});
