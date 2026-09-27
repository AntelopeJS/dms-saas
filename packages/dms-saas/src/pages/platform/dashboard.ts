import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  ChartArea,
  ChartCard,
  ChartDonut,
  Grid,
  GridRow,
  KpiCard,
  TopListCard,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { SAAS_MODULE_ID } from "../module";
import { overviewCategory } from "./categories";

const DASHBOARD_KPI_WORKSPACES = "/api/saas/dashboard/kpi/workspaces";
const DASHBOARD_KPI_MRR = "/api/saas/dashboard/kpi/mrr";
const DASHBOARD_KPI_ACTIVE_SUBS =
  "/api/saas/dashboard/kpi/active-subscriptions";
const DASHBOARD_KPI_OPEN_INVOICES = "/api/saas/dashboard/kpi/open-invoices";
const DASHBOARD_TOP_PLANS = "/api/saas/dashboard/top-plans";
const DASHBOARD_CHART_REVENUE = "/api/saas/dashboard/chart/revenue";
const DASHBOARD_CHART_SUBSCRIPTIONS =
  "/api/saas/dashboard/chart/subscriptions-by-status";

const recentActivity = CustomComponent("DmsSaasRecentActivity").meta({
  name: "$saas.dashboard.recent_activity",
  icon: "i-ph-pulse",
});

@RegisterPage()
export class SaasDashboardController extends PageController(
  "dashboard",
  {
    displayName: "$saas.dashboard.title",
    module: SAAS_MODULE_ID,
    category: overviewCategory,
    icon: "i-ph-house",
    description: "$saas.dashboard.description",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static kpis = Grid({ gap: "1rem" }).child(
    "row",
    GridRow()
      .child(
        "workspaces",
        KpiCard({
          title: "$saas.dashboard.kpi.workspaces",
          icon: "i-ph-buildings",
          fetchUrl: DASHBOARD_KPI_WORKSPACES,
          valueFormat: "compact",
        }),
      )
      .child(
        "mrr",
        KpiCard({
          title: "$saas.dashboard.kpi.mrr",
          icon: "i-ph-currency-circle-dollar",
          fetchUrl: DASHBOARD_KPI_MRR,
          valueFormat: "currency",
          currencyCode: "EUR",
          showSparkline: true,
        }),
      )
      .child(
        "active",
        KpiCard({
          title: "$saas.dashboard.kpi.active_subscriptions",
          icon: "i-ph-stack",
          fetchUrl: DASHBOARD_KPI_ACTIVE_SUBS,
          valueFormat: "compact",
        }),
      )
      .child(
        "invoices",
        KpiCard({
          title: "$saas.dashboard.kpi.invoices_open",
          icon: "i-ph-receipt",
          fetchUrl: DASHBOARD_KPI_OPEN_INVOICES,
          valueFormat: "compact",
        }),
      ),
  );

  static charts = Grid({ gap: "1rem" })
    .child(
      "primaryRow",
      GridRow()
        .child(
          "revenue",
          ChartCard({
            title: "$saas.dashboard.chart_revenue",
            icon: "i-ph-chart-line",
            fetchUrl: DASHBOARD_CHART_REVENUE,
            valueFormat: "currency",
            currencyCode: "EUR",
            chart: ChartArea({ smooth: true }),
          }),
        )
        .child(
          "subscriptions",
          // The card fetches; the nested donut draws the card's first series.
          ChartCard({
            title: "$saas.dashboard.subscriptions_title",
            description: "$saas.dashboard.subscriptions_description",
            icon: "i-ph-chart-donut",
            fetchUrl: DASHBOARD_CHART_SUBSCRIPTIONS,
            showDelta: false,
            chart: ChartDonut({ showLegend: true }),
          }),
        ),
    )
    .child(
      "secondaryRow",
      GridRow()
        .child(
          "topPlans",
          TopListCard({
            title: "$saas.dashboard.top_plans",
            fetchUrl: DASHBOARD_TOP_PLANS,
            showRank: true,
            showDelta: true,
          }),
        )
        .child("activity", recentActivity),
    );
}
