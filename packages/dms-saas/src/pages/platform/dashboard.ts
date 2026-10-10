import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  ActivityFeed,
  Card,
  ChartCard,
  ChartColumn,
  Grid,
  GridRow,
  KeyValueList,
  KpiCard,
  NavCardGrid,
  PeriodSelector,
  StatGroup,
  Tab,
  TopListCard,
} from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ACTIVITY_KINDS } from "../../metrics/activity";
import { SAAS_MODULE_ID } from "../module";
import { overviewCategory } from "./categories";
import { WORKSPACES_PAGE_PATH } from "./paths";
import {
  CREATE_WORKSPACE_BUTTON,
  inReportingCurrency,
  permissionMeta,
} from "./workspaces/shared";

const API = "/api/saas/dashboard";
const PERIOD_SCOPE = "saas-dashboard";
const K = "$saas.dashboard";
const HEADLINE_FIGURES = 3;
const ATTENTION_QUEUES = 4;
const ACTIVITY_ENTRIES = 8;

const activityTabs = ACTIVITY_KINDS.reduce(
  (tabs, kind) =>
    tabs.child(
      kind,
      ActivityFeed({
        card: false,
        groupByDay: false,
        maxItems: ACTIVITY_ENTRIES,
        fetchUrl: `${API}/activity?kind=${kind}`,
        empty: { title: `${K}.activity.empty` },
      }).meta(permissionMeta(`activity_${kind}`, "i-ph-pulse")),
      { slot: kind },
    ),
  Tab({
    items: ACTIVITY_KINDS.map((kind) => ({
      label: `${K}.activity.tabs.${kind}`,
      slot: kind,
    })),
  }).meta(permissionMeta("activity_tabs", "i-ph-tabs")),
);

@RegisterPage()
export class SaasDashboardController extends PageController(
  "dashboard",
  {
    displayName: `${K}.title`,
    module: SAAS_MODULE_ID,
    category: overviewCategory,
    icon: "i-ph-house",
    description: `${K}.description`,
    order: 0,
  },
  DefaultLayout({ fullWidth: true, headerActions: [CREATE_WORKSPACE_BUTTON] }),
) {
  static period = PeriodSelector({
    id: PERIOD_SCOPE,
    presets: ["last-30-days", "last-90-days", "ytd"],
    defaultPreset: "last-30-days",
    comparisons: ["none", "previous-period"],
    defaultComparison: "previous-period",
    variant: "segmented",
    align: "right",
    size: "sm",
  }).meta(permissionMeta("period", "i-ph-calendar"));

  static attention = NavCardGrid({
    title: `${K}.attention.title`,
    description: `${K}.attention.description`,
    fetchUrl: `${API}/attention`,
    columns: ATTENTION_QUEUES,
    skeletonCount: ATTENTION_QUEUES,
    empty: {
      title: `${K}.attention.empty_title`,
      description: `${K}.attention.empty_description`,
    },
  }).meta(permissionMeta("attention", "i-ph-bell-ringing"));

  static figures = Grid({ gap: "1rem" })
    .child(
      "row",
      GridRow()
        .child(
          "headline",
          StatGroup({
            layout: "cards",
            columns: HEADLINE_FIGURES,
            skeletonCount: HEADLINE_FIGURES,
            label: `${K}.headline.label`,
            fetchUrl: `${API}/headline`,
          }).meta(permissionMeta("headline", "i-ph-currency-circle-dollar")),
          { colSpan: HEADLINE_FIGURES },
        )
        .child(
          "churn",
          KpiCard({
            title: `${K}.churn.title`,
            description: `${K}.churn.description`,
            variant: "stat",
            icon: "i-ph-trend-down",
            fetchUrl: `${API}/churn`,
            periodScope: PERIOD_SCOPE,
            valueFormat: "percent",
            invert: true,
            showDelta: true,
          }),
        )
        .meta(permissionMeta("figures_row", "i-ph-rows")),
    )
    .meta(permissionMeta("figures", "i-ph-squares-four"));

  static charts = Grid({ gap: "1rem" })
    .child(
      "row",
      GridRow()
        .child(
          "paidInvoices",
          inReportingCurrency(
            ChartCard({
              title: `${K}.paid_invoices.title`,
              description: `${K}.paid_invoices.description`,
              icon: "i-ph-receipt",
              fetchUrl: `${API}/paid-invoices`,
              periodScope: PERIOD_SCOPE,
              valueFormat: "currency",
              valuePrecision: "native",
              showDelta: true,
              chart: ChartColumn({
                xaxisType: "datetime",
                showLegend: true,
                color: ["success", "info"],
              }),
            }),
          ),
          { colSpan: 2 },
        )
        .child(
          "byStatus",
          Card({
            title: `${K}.by_status.title`,
            description: `${K}.by_status.description`,
            actions: [
              {
                label: `${K}.by_status.open_list`,
                to: WORKSPACES_PAGE_PATH,
                icon: "i-ph-arrow-right",
              },
            ],
          }).child(
            "list",
            KeyValueList({
              card: false,
              dense: true,
              fetchUrl: `${API}/workspaces-by-status`,
              skeletonCount: 7,
            }).meta(permissionMeta("by_status_list", "i-ph-list-dashes")),
          ),
        )
        .meta(permissionMeta("charts_row", "i-ph-rows")),
    )
    .meta(permissionMeta("charts", "i-ph-chart-bar"));

  static lists = Grid({ gap: "1rem" })
    .child(
      "row",
      GridRow()
        .child(
          "plans",
          inReportingCurrency(
            TopListCard({
              title: `${K}.plans.title`,
              description: `${K}.plans.subtitle`,
              fetchUrl: `${API}/plans-by-mrr`,
              valueFormat: "currency",
              valuePrecision: "native",
              showRank: true,
              skeletonCount: 4,
              emptyLabel: `${K}.plans.empty`,
            }),
          ),
        )
        .child(
          "activity",
          Card({ title: `${K}.activity.title` }).child("tabs", activityTabs),
        )
        .meta(permissionMeta("lists_row", "i-ph-rows")),
    )
    .meta(permissionMeta("lists", "i-ph-list"));
}
