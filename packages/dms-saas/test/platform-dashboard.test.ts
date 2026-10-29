import { describe, expect, it } from "vitest";
import type { Invoice } from "../src/db";
import {
  type DirectoryRow,
  summariseDirectory,
} from "../src/metrics/directory-summary";
import {
  attentionCards,
  dashboardHeadline,
  plansByMrrItems,
  workspacesByStatusItems,
  workspacesHeadline,
} from "../src/metrics/headline-items";
import {
  churnKpi,
  churnOver,
  paidInvoicesChart,
  parseComparison,
  readPeriodQuery,
} from "../src/metrics/revenue";
import { SaasDashboardController } from "../src/pages/platform/dashboard";
import { missingKeys, writeText } from "./helpers/composed-text";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-07T12:00:00Z");

function row(overrides: Partial<DirectoryRow>): DirectoryRow {
  return {
    _id: overrides.tenantId ?? "t",
    tenantId: "t",
    billingState: "active",
    currency: "EUR",
    mrrMinor: 0,
    planId: "plan_pro",
    planName: "Pro",
    planUnitAmountMinor: 2_900,
    planInterval: "month",
    planBillingMode: "flat",
    seats: 1,
    ...overrides,
  } as DirectoryRow;
}

const ROWS: DirectoryRow[] = [
  row({
    tenantId: "a",
    mrrMinor: 112_700,
    planId: "plan_business",
    planName: "Business",
  }),
  row({ tenantId: "b", mrrMinor: 2_900 }),
  row({
    tenantId: "c",
    billingState: "past_due",
    mrrMinor: 49_000,
    renewalKind: "suspends",
    renewsAt: new Date(NOW.getTime() + 5 * DAY_MS),
  }),
  row({
    tenantId: "d",
    billingState: "trialing",
    renewalKind: "trial_ends",
    renewsAt: new Date(NOW.getTime() + 6 * DAY_MS),
  }),
  row({
    tenantId: "e",
    billingState: "free",
    isComplimentary: true,
    renewalKind: "free_until",
    renewsAt: new Date(NOW.getTime() + 3 * DAY_MS),
  }),
  row({ tenantId: "f", mrrMinor: 10_000, currency: "USD" }),
  row({
    tenantId: "g",
    billingState: "cancelled",
    previousMrrMinor: 9_100,
    stateSince: new Date(NOW.getTime() - 10 * DAY_MS),
  }),
];

describe("directory summary", () => {
  const summary = summariseDirectory(ROWS, NOW, "EUR");

  it("counts the workspaces of each status", () => {
    expect(summary.total).toBe(7);
    expect(summary.byState).toMatchObject({
      active: 3,
      past_due: 1,
      trialing: 1,
      free: 1,
      cancelled: 1,
      suspended: 0,
    });
  });

  it("sums MRR in the reporting currency and sets the others apart", () => {
    expect(summary.mrr).toEqual({
      amountMinor: 164_600,
      currency: "EUR",
      otherCurrencies: [{ currency: "USD", amountMinor: 10_000 }],
    });
    expect(summary.paying).toBe(4);
  });

  it("puts a figure on what past-due workspaces put at risk, and when the first is suspended", () => {
    expect(summary.pastDue.count).toBe(1);
    expect(summary.pastDue.atRisk.amountMinor).toBe(49_000);
    expect(summary.pastDue.firstSuspension).toEqual(
      new Date(NOW.getTime() + 5 * DAY_MS),
    );
  });

  it("finds the trials and complimentary accesses about to end", () => {
    expect(summary.trialsEnding).toMatchObject({
      count: 1,
      thenMrr: { amountMinor: 2_900 },
    });
    expect(summary.complimentaryEnding.map((entry) => entry.tenantId)).toEqual([
      "e",
    ]);
  });
});

describe("dashboard headline and attention queue", () => {
  const summary = summariseDirectory(ROWS, NOW, "EUR");

  it("says which currencies MRR leaves out", () => {
    const [mrr] = dashboardHeadline(summary);

    expect(mrr?.value).toEqual({
      key: "saas.text.value",
      params: { value: { type: "money", value: 164_600, currency: "EUR" } },
    });
    expect(writeText(mrr!.detail!)).toContain("$100.00");
  });

  it("shows one card per queue that holds something, in the order of urgency", () => {
    const cards = attentionCards({
      summary,
      complimentaryEnding: [
        { tenantId: "e", name: "Globex", at: new Date("2026-10-10T00:00:00Z") },
      ],
      migrations: {
        count: 0,
        firstFromPlan: "—",
        firstToPlan: "—",
        firstFailed: 0,
        firstTotal: 0,
      },
      openInvoices: {
        count: 2,
        awaiting: { amountMinor: 32_150, currency: "EUR", otherCurrencies: [] },
      },
    });

    expect(cards.map((card) => card.id)).toEqual([
      "past_due",
      "complimentary_ending",
      "open_invoices",
    ]);
    expect(writeText(cards[0]?.title)).toBe("1 workspace past due");
    expect(writeText(cards[1]?.description)).toBe("Globex on 10 Oct");
    expect(writeText(cards[2]?.description)).toBe("€321.50 awaiting payment");
    expect(cards[0]?.to).toBe(
      "/modules/saas/customers/workspaces?tab=past_due",
    );
  });

  it("shows nothing when every queue is empty", () => {
    const cards = attentionCards({
      summary: summariseDirectory([row({})], NOW, "EUR"),
      complimentaryEnding: [],
      migrations: {
        count: 0,
        firstFromPlan: "—",
        firstToPlan: "—",
        firstFailed: 0,
        firstTotal: 0,
      },
      openInvoices: {
        count: 0,
        awaiting: { amountMinor: 0, currency: "EUR", otherCurrencies: [] },
      },
    });

    expect(cards).toEqual([]);
  });

  it("names the workspace list's endings in its own headline", () => {
    const items = workspacesHeadline(summary, [
      { tenantId: "e", name: "Globex", at: new Date("2026-10-10T00:00:00Z") },
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "mrr",
      "past_due",
      "complimentary_ending",
      "trials_ending",
    ]);
    expect(items[2]).toMatchObject({
      value: 1,
      detail: {
        key: "saas.workspaces.headline.named_ending",
        params: { name: "Globex", date: { type: "date", format: "day" } },
      },
    });
    expect(writeText(items[2]!.detail!)).toBe("Globex 10 Oct");
  });

  it("lists every status in its own tone, linking to its tab", () => {
    const items = workspacesByStatusItems(summary);

    expect(items.map((item) => item.id)).toEqual([
      "active",
      "trialing",
      "free",
      "past_due",
      "pending_payment",
      "suspended",
      "cancelled",
    ]);
    expect(items.find((item) => item.id === "past_due")).toMatchObject({
      value: 1,
      tone: "error",
      to: "/modules/saas/customers/workspaces?tab=past_due",
    });
  });

  it("ranks the plans by the MRR they bring", () => {
    const items = plansByMrrItems(ROWS, "EUR");

    expect(items.map((item) => [item.title, item.value])).toEqual([
      ["Business", 1_127],
      ["Pro", 519],
    ]);
    expect(writeText(items[1]?.description)).toBe(
      "2 paying workspaces · €29.00 / month",
    );
  });
});

describe("revenue churn", () => {
  it("weighs the MRR cancelled over the period against the MRR it started with", () => {
    const summary = summariseDirectory(ROWS, NOW, "EUR");
    const churn = churnOver(
      ROWS,
      { from: new Date(NOW.getTime() - 30 * DAY_MS), to: NOW },
      summary.mrr,
    );

    expect(churn.cancellations).toBe(1);
    expect(churn.lost.amountMinor).toBe(9_100);
    expect(churn.rate).toBeCloseTo((9_100 / (164_600 + 9_100)) * 100);
  });

  it("finds no churn outside the period", () => {
    const churn = churnOver(
      ROWS,
      { from: new Date(NOW.getTime() - 5 * DAY_MS), to: NOW },
      { amountMinor: 0, currency: "EUR", otherCurrencies: [] },
    );

    expect(churn).toMatchObject({ rate: 0, cancellations: 0 });
  });
});

function document(overrides: Partial<Invoice>): Invoice {
  return {
    documentType: "invoice",
    status: "paid",
    currency: "eur",
    total: 1_000,
    amount: 1_000,
    issuedAt: NOW,
    paidAt: NOW,
    ...overrides,
  } as Invoice;
}

describe("paid invoices chart", () => {
  const range = { from: new Date(NOW.getTime() - 29 * DAY_MS), to: NOW };

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
    const chart = paidInvoicesChart([document({})], range, null, "EUR");

    expect(chart).toEqual({
      value: 10,
      series: expect.any(Array),
    });
  });
});

describe("comparison window", () => {
  const from = "2025-09-08T00:00:00.000Z";
  const to = "2025-10-07T23:59:59.999Z";

  it("reads the window the selector sends", () => {
    expect(parseComparison(from, to, "previous-year")).toEqual({
      from: new Date(from),
      to: new Date(to),
    });
  });

  it("reads the period and the comparison from the selector's query", () => {
    const query = new URLSearchParams({
      from: "2026-09-08T00:00:00.000Z",
      to: "2026-10-07T23:59:59.999Z",
      compareFrom: from,
      compareTo: to,
      preset: "last-30-days",
      comparison: "previous-year",
    });

    expect(readPeriodQuery(query)).toEqual({
      range: {
        from: new Date("2026-09-08T00:00:00.000Z"),
        to: new Date("2026-10-07T23:59:59.999Z"),
      },
      comparison: { from: new Date(from), to: new Date(to) },
      comparisonMode: "previous-year",
    });
  });

  it("reads no comparison when the query names none", () => {
    const query = new URLSearchParams({ comparison: "none" });

    expect(readPeriodQuery(query, NOW)).toEqual({
      range: { from: new Date(NOW.getTime() - 30 * DAY_MS), to: NOW },
      comparison: null,
      comparisonMode: "none",
    });
  });

  it("reads none when the selector compares with nothing", () => {
    expect(parseComparison(from, to, "none")).toBeNull();
    expect(parseComparison(undefined, undefined, "previous-period")).toBeNull();
  });

  it("compares the churn with the same days a year before, or not at all", () => {
    const rows = [
      row({
        billingState: "cancelled",
        previousMrrMinor: 5_000,
        stateSince: new Date("2025-09-20T00:00:00Z"),
      }),
      row({
        tenantId: "h",
        billingState: "cancelled",
        previousMrrMinor: 10_000,
        stateSince: new Date(NOW.getTime() - 2 * DAY_MS),
      }),
    ];
    const mrr = { amountMinor: 40_000, currency: "EUR", otherCurrencies: [] };
    const query = new URLSearchParams({
      from: new Date(NOW.getTime() - 29 * DAY_MS).toISOString(),
      to: NOW.toISOString(),
      compareFrom: from,
      compareTo: to,
    });

    query.set("comparison", "previous-year");
    expect(churnKpi(rows, readPeriodQuery(query), mrr)).toEqual({
      value: 20,
      previousValue: expect.closeTo(100 / 9),
      delta: expect.closeTo(80),
    });
    query.set("comparison", "none");
    expect(churnKpi(rows, readPeriodQuery(query), mrr)).toEqual({ value: 20 });
  });

  it("finds the churn of the same days a year before", () => {
    const rows = [
      row({
        billingState: "cancelled",
        previousMrrMinor: 5_000,
        stateSince: new Date("2025-09-20T00:00:00Z"),
      }),
    ];
    const mrr = { amountMinor: 45_000, currency: "EUR", otherCurrencies: [] };

    expect(
      churnOver(rows, { from: new Date(from), to: new Date(to) }, mrr).rate,
    ).toBeCloseTo(10);
    expect(
      churnOver(
        rows,
        { from: new Date(NOW.getTime() - 30 * DAY_MS), to: NOW },
        mrr,
      ).rate,
    ).toBe(0);
  });
});

interface SerializedBlock {
  componentName?: string;
  options?: Record<string, unknown>;
  children: { id: string; component: SerializedBlock }[];
}

function findChild(
  block: SerializedBlock,
  id: string,
): SerializedBlock | undefined {
  for (const child of block.children) {
    if (child.id === id) return child.component;
    const nested = findChild(child.component, id);
    if (nested) return nested;
  }
  return undefined;
}

describe("dashboard page", () => {
  it("leads with the attention queue fed by its route", () => {
    const attention =
      SaasDashboardController.attention.serializeSync() as SerializedBlock;

    expect(attention.componentName).toBe("dms-nav-card-grid-block");
    expect(attention.options).toMatchObject({
      fetchUrl: "/api/saas/dashboard/attention",
    });
  });

  it("opens on a period bar without live mode, the comparisons a menu", () => {
    const toolbar =
      SaasDashboardController.toolbar.serializeSync() as SerializedBlock;

    expect(toolbar.componentName).toBe("dms-page-toolbar-block");
    expect(toolbar.children.map((child) => child.id)).toEqual(["period"]);
    expect(findChild(toolbar, "period")?.options).toMatchObject({
      presets: ["last-30-days", "last-90-days", "ytd"],
      rangeLabel: "relative",
      rememberKey: "saas",
      comparisons: ["previous-period", "previous-year", "none"],
      defaultComparison: "previous-period",
      comparisonControl: "menu",
    });
  });

  it("binds the churn and the paid invoices to the period selector", () => {
    const toolbar =
      SaasDashboardController.toolbar.serializeSync() as SerializedBlock;
    const period = findChild(toolbar, "period");
    const figures =
      SaasDashboardController.figures.serializeSync() as SerializedBlock;
    const charts =
      SaasDashboardController.charts.serializeSync() as SerializedBlock;
    const scope = period?.options?.id;

    expect(findChild(figures, "churn")?.options).toMatchObject({
      periodScope: scope,
    });
    expect(findChild(charts, "paidInvoices")?.options).toMatchObject({
      periodScope: scope,
    });
  });

  it("links the plans ranking to the catalogue and fits the activity tabs", () => {
    const lists =
      SaasDashboardController.lists.serializeSync() as SerializedBlock;

    expect(findChild(lists, "plans")?.options).toMatchObject({
      actions: [{ to: "/modules/saas/catalog/plans" }],
    });
    expect(findChild(lists, "tabs")?.options).toMatchObject({ fit: true });
  });

  it("hangs the day's credits under its collected bar, the comparison dashed", () => {
    const charts =
      SaasDashboardController.charts.serializeSync() as SerializedBlock;
    const card = findChild(charts, "paidInvoices");

    expect(card && findChild(card, "chart")?.options).toMatchObject({
      type: "column",
      stacked: true,
      comparisonStyle: "dashed",
    });
  });

  it.each(["en-GB", "fr-FR"])("%s has every key the headlines name", (code) => {
    const summary = summariseDirectory(ROWS, NOW, "EUR");
    const endings = [
      { tenantId: "e", name: "Globex", at: new Date("2026-10-10T00:00:00Z") },
    ];
    expect(
      missingKeys(
        [
          dashboardHeadline(summary),
          workspacesHeadline(summary, endings),
          workspacesHeadline(summariseDirectory([row({})], NOW, "EUR"), []),
        ],
        code,
      ),
    ).toEqual([]);
  });
});
