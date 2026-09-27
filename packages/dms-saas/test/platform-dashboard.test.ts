import type { User } from "@antelopejs/interface-dms/auth/db";
import { describe, expect, it } from "vitest";
import type { InvoiceModel, TenantSubscriptionModel } from "../src/db";
import { SaasDashboardController as SaasDashboardPageController } from "../src/pages/platform/dashboard";
import { SaasDashboardController } from "../src/routes/platformOwner/dashboard";

interface StatusRow {
  status: string | null;
}

const OWNER = {} as User;

function subscriptionModel(rows: StatusRow[]): TenantSubscriptionModel {
  return {
    table: { pluck: () => ({ run: async () => rows }) },
  } as unknown as TenantSubscriptionModel;
}

function dashboard(rows: StatusRow[]): SaasDashboardController {
  const controller = new SaasDashboardController();
  controller.tenantSubscriptionModel = subscriptionModel(rows);
  return controller;
}

const SUBSCRIPTIONS: StatusRow[] = [
  { status: "active" },
  { status: "active" },
  { status: "trialing" },
  { status: "suspended" },
  { status: null },
];

describe("back-office dashboard subscriptions", () => {
  it("counts active and trialing subscriptions as active", async () => {
    await expect(dashboard(SUBSCRIPTIONS).kpiActive(OWNER)).resolves.toEqual({
      value: 3,
    });
  });

  it("feeds the chart card its headline value and series", async () => {
    const payload =
      await dashboard(SUBSCRIPTIONS).chartSubscriptionsByStatus(OWNER);

    expect(payload.value).toBe(4);
    expect(payload.series).toEqual([
      {
        name: "subscriptions",
        data: [
          { x: "Active", y: 2, label: "Active" },
          { x: "Trialing", y: 1, label: "Trialing" },
          { x: "Suspended", y: 1, label: "Suspended" },
        ],
      },
    ]);
  });

  it("agrees with the active KPI when every subscription is active", async () => {
    const controller = dashboard([{ status: "active" }]);

    const [active, chart] = await Promise.all([
      controller.kpiActive(OWNER),
      controller.chartSubscriptionsByStatus(OWNER),
    ]);

    expect(chart.value).toBe(active.value);
  });

  it("gives the revenue card the total of its monthly series", async () => {
    const controller = new SaasDashboardController();
    const issuedAt = new Date();
    controller.invoiceModel = {
      table: {
        getAll: () => ({
          filter: () => ({
            pluck: () => ({
              run: async () => [
                { amount: 2_000, issuedAt },
                { amount: 500, issuedAt },
              ],
            }),
          }),
        }),
      },
    } as unknown as InvoiceModel;

    const payload = await controller.chartRevenue(OWNER);

    expect(payload.value).toBe(25);
    expect(payload.series[0]?.data.at(-1)?.y).toBe(25);
  });
});

interface SerializedBlock {
  componentName?: string;
  options?: Record<string, unknown>;
  children: SerializedChild[];
}

interface SerializedChild {
  id: string;
  component: SerializedBlock;
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

describe("back-office dashboard layout", () => {
  it("nests the subscriptions donut in a card that fetches its series", () => {
    const charts =
      SaasDashboardPageController.charts.serializeSync() as SerializedBlock;
    const card = findChild(charts, "subscriptions");
    const donut = card && findChild(card, "chart");

    expect(card?.componentName).toBe("dms-chart-card");
    expect(card?.options).toMatchObject({
      fetchUrl: "/api/saas/dashboard/chart/subscriptions-by-status",
    });
    expect(donut?.componentName).toBe("dms-chart");
    expect(donut?.options).toMatchObject({ type: "donut" });
    expect(donut?.options).not.toHaveProperty("fetchUrl");
  });
});
