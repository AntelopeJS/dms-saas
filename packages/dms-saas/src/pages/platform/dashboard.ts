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
  pageToolbar,
  StatGroup,
  Tab,
  TopListCard,
} from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ACTIVITY_KINDS } from "../../metrics/activity";
import { SAAS_MODULE_ID } from "../module";
import { overviewCategory } from "./categories";
import { PLANS_PAGE_PATH, WORKSPACES_PAGE_PATH } from "./paths";
import {
  CREATE_WORKSPACE_BUTTON,
  inReportingCurrency,
  permissionMeta,
} from "./workspaces/shared";

const API = "/api/saas/dashboard";
const PERIOD_SCOPE = "saas-dashboard";
/** The module's pages with a period share the last one chosen. */
const PERIOD_REMEMBER_KEY = "saas";
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
    fit: true,
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
  // No `live`: the bar shows when the figures were read and a refresh button,
  // then the period, whose comparisons the toolbar offers as a menu. The
  // selector keeps its roles editor name through `meta`.
  static toolbar = pageToolbar({
    live: false,
    period: {
      id: PERIOD_SCOPE,
      rememberKey: PERIOD_REMEMBER_KEY,
      presets: ["last-30-days", "last-90-days", "ytd"],
      defaultPreset: "last-30-days",
      comparisons: ["previous-period", "previous-year", "none"],
      meta: permissionMeta("period", "i-ph-calendar"),
    },
  }).meta(permissionMeta("toolbar", "i-ph-sliders-horizontal"));

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
              // Credits are negative: stacked, they hang under the day's
              // collected bar, which then takes the whole column instead of
              // half of it. `columnWidth` is a fixed pixel width, too wide
              // for the 90 daily bars of a quarter. The compared window's
              // collected money is a dashed line over the bars.
              chart: ChartColumn({
                xaxisType: "datetime",
                stacked: true,
                showLegend: true,
                color: ["success", "info"],
                comparisonStyle: "dashed",
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
              showBar: true,
              skeletonCount: 4,
              emptyLabel: `${K}.plans.empty`,
              actions: [
                {
                  label: `${K}.plans.open_catalogue`,
                  to: PLANS_PAGE_PATH,
                  icon: "i-ph-arrow-right",
                },
              ],
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
