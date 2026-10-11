import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  ActivityFeed,
  Banner,
  DefaultDisplays,
  Grid,
  GridRow,
  KeyValueList,
  NavCardGrid,
  StatGroup,
  TableView,
  type TableViewSourceColumn,
  tableViewFromSource,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { planMigrationsDataAPI } from "../../../data-api";
import {
  MIGRATION_WORKSPACE_STATUSES,
  MIGRATION_WORKSPACE_TONES,
} from "../../../plans/migration-detail";
import { PLAN_MIGRATION_TOPIC } from "../../../plans/migration-realtime";
import { SAAS_MODULE_ID } from "../../module";
import { catalogCategory } from "../categories";

const TEXTS = "$saas.catalog.migrations";
const PERMISSIONS = "$saas.permissions.catalog";
export const PLAN_MIGRATIONS_PAGE_URL = "/modules/saas/catalog/plan-migrations";
const PLAN_MIGRATIONS_ENDPOINT = "/api/saas/plan-migrations";
const PLANS_PAGE_URL = "/modules/saas/catalog/plans";
const MIGRATIONS_ORDER = 5;
const ATTENTION_COLUMNS = 2;
const NEEDS_ATTENTION_STAGE = "needs_attention";

function stageTab(id: string, icon: string, stage: string) {
  return {
    id,
    label: `${TEXTS}.tabs.${id}`,
    icon,
    filter: { accessorKey: "stage", value: stage, mode: "is" },
    // The menu entry carries the count of migrations waiting for someone.
    navBadge: stage === NEEDS_ATTENTION_STAGE,
  };
}

@RegisterPage()
export class SaasPlanMigrationsController extends PageController(
  "plan-migrations",
  {
    displayName: `${TEXTS}.title`,
    module: SAAS_MODULE_ID,
    category: catalogCategory,
    icon: "i-ph-arrows-clockwise",
    description: `${TEXTS}.description`,
    order: MIGRATIONS_ORDER,
  },
  DefaultLayout({
    fullWidth: true,
    headerActions: [
      {
        label: `${TEXTS}.plans_button`,
        icon: "i-ph-stack",
        color: "neutral",
        target: { type: "page", url: PLANS_PAGE_URL },
      },
    ],
  }),
) {
  static attention = NavCardGrid({
    fetchUrl: `${PLAN_MIGRATIONS_ENDPOINT}/attention`,
    columns: ATTENTION_COLUMNS,
    skeletonCount: 1,
    empty: {
      title: `${TEXTS}.attention.empty_title`,
      description: `${TEXTS}.attention.empty_description`,
    },
  }).meta({
    name: `${PERMISSIONS}.migrations_attention`,
    description: `${PERMISSIONS}.migrations_attention_description`,
    icon: "i-ph-warning-circle",
  });

  static table = TableView(planMigrationsDataAPI, {
    caption: `${TEXTS}.caption`,
    labelKey: "title",
    searchPlaceholder: `${TEXTS}.search`,
    defaultSort: { field: "createdAt", desc: true },
    tabs: [
      { id: "all", label: `${TEXTS}.tabs.all`, icon: "i-ph-list" },
      stageTab("running", "i-ph-spinner-gap", "running"),
      stageTab("needs_attention", "i-ph-warning-circle", NEEDS_ATTENTION_STAGE),
      stageTab("completed", "i-ph-check-circle", "done"),
    ],
    rowActions: {
      add: false,
      edit: false,
      delete: false,
      duplicate: false,
      copyLink: true,
      hasSelection: false,
      details: { isEnabled: true, isVisible: false },
    },
    formContainer: {
      type: "page",
      pages: { details: { urlSlug: ":id", customPage: true } },
    },
    footer: { countLabel: `${TEXTS}.count`, hint: `${TEXTS}.footer_hint` },
    emptyStates: {
      firstRun: {
        title: `${TEXTS}.empty.title`,
        description: `${TEXTS}.empty.description`,
        icon: "i-ph-arrows-clockwise",
        actions: [{ label: `${TEXTS}.plans_button`, to: PLANS_PAGE_URL }],
      },
    },
  });
}

const DETAIL_API = `${PLAN_MIGRATIONS_ENDPOINT}/{{params.id}}`;
const DETAIL = `${TEXTS}.detail`;
const TOTALS_COUNT = 4;
const JOURNAL_SKELETON_ROWS = 3;
const ROW_API = `${PLAN_MIGRATIONS_ENDPOINT}/{migrationId}/workspaces/{_id}`;
const OUTCOME_COLUMN_SIZE = 150;
const NAME_COLUMN_SIZE = 200;
const STRIPE_COLUMN_SIZE = 215;
const REASON_COLUMN_SIZE = 240;
const TIME_COLUMN_SIZE = 150;
const ATTENTION_GROUP = "attention";

/** Name, description and icon of a block as the roles editor lists it. */
function detailMeta(key: string, icon: string) {
  return {
    name: `${PERMISSIONS}.migration_${key}`,
    description: `${PERMISSIONS}.migration_${key}_description`,
    icon,
  };
}

const OUTCOME_ITEMS = MIGRATION_WORKSPACE_STATUSES.map((value) => ({
  value,
  label: `${TEXTS}.workspace_status.${value}`,
}));

const WORKSPACE_COLUMNS: Record<string, TableViewSourceColumn> = {
  name: {
    name: `${DETAIL}.column.workspace`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.IdentityDisplay({ icon: "i-ph-buildings" }),
    size: NAME_COLUMN_SIZE,
    sortable: true,
    order: 1,
  },
  outcome: {
    name: `${DETAIL}.column.outcome`,
    type: new DefaultDataTypes.SelectType({ items: OUTCOME_ITEMS }),
    display: new DefaultDisplays.StatusPillDisplay({
      tones: { ...MIGRATION_WORKSPACE_TONES },
      subField: "outcomeNote",
      liveValues: ["running"],
    }),
    size: OUTCOME_COLUMN_SIZE,
    sortable: true,
    order: 2,
  },
  stripeSubscriptionId: {
    name: `${DETAIL}.column.stripe`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    size: STRIPE_COLUMN_SIZE,
    order: 3,
  },
  reason: {
    name: `${DETAIL}.column.reason`,
    type: new DefaultDataTypes.StringType(),
    cellWrap: true,
    size: REASON_COLUMN_SIZE,
    order: 4,
  },
  updatedAt: {
    name: `${DETAIL}.column.time`,
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.TwoLineDisplay({ primaryField: "timeText" }),
    size: TIME_COLUMN_SIZE,
    sortable: true,
    order: 5,
  },
  group: {
    name: `${DETAIL}.column.group`,
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    isVisible: false,
    order: 6,
  },
};

function resolveAction(resolution: "moved" | "not_moved", icon: string) {
  return {
    label: `${DETAIL}.${resolution}_action`,
    icon,
    rule: { field: "canResolve", equals: true },
    target: {
      type: "api" as const,
      url: `${ROW_API}/resolve`,
      method: "POST" as const,
      body: { resolution },
      successMessage: `${DETAIL}.${resolution}_done`,
    },
    confirm: { from: `${ROW_API}/dialogs/${resolution}` },
  };
}

const workspaces = tableViewFromSource({
  caption: `${DETAIL}.all_workspaces`,
  fetchUrl: `${DETAIL_API}/workspaces`,
  capabilities: { filter: true },
  realtimeTopic: PLAN_MIGRATION_TOPIC,
  labelKey: "name",
  searchPlaceholder: `${DETAIL}.search`,
  columns: WORKSPACE_COLUMNS,
  tabs: [
    { id: "all", label: `${DETAIL}.tab_all`, icon: "i-ph-list" },
    {
      id: "needs_attention",
      label: `${TEXTS}.tabs.needs_attention`,
      icon: "i-ph-warning-circle",
      filter: { accessorKey: "group", value: ATTENTION_GROUP, mode: "is" },
    },
  ],
  rowActions: {
    custom: [
      {
        label: `${DETAIL}.check_stripe`,
        icon: "i-ph-stripe-logo",
        isVisible: true,
        showLabel: true,
        rule: { field: "isUncertain", equals: true },
        target: {
          type: "drawer",
          direction: "right",
          title: `${DETAIL}.stripe_check_title`,
          component: CustomComponent("DmsSaasMigrationStripeCheck").meta(
            detailMeta("stripe_check", "i-ph-stripe-logo"),
          ),
        },
      },
      resolveAction("moved", "i-ph-check"),
      resolveAction("not_moved", "i-ph-arrow-counter-clockwise"),
      {
        label: `${DETAIL}.open_stripe`,
        icon: "i-ph-arrow-square-out",
        rule: { field: "stripeUrl", notEquals: null },
        target: { type: "external", url: "{stripeUrl}", newTab: true },
      },
    ],
  },
  footer: { countLabel: `${DETAIL}.workspace_count` },
  emptyStates: {
    firstRun: {
      title: `${DETAIL}.no_workspace`,
      icon: "i-ph-buildings",
    },
  },
}).meta(detailMeta("workspaces", "i-ph-buildings"));

const changes = KeyValueList({
  title: `${DETAIL}.changes`,
  fetchUrl: `${DETAIL_API}/changes`,
  empty: { title: `${DETAIL}.changes_empty` },
}).meta(detailMeta("changes", "i-ph-git-diff"));

const journal = ActivityFeed({
  title: `${DETAIL}.journal.title`,
  fetchUrl: `${DETAIL_API}/journal`,
  realtimeTopic: PLAN_MIGRATION_TOPIC,
  skeletonCount: JOURNAL_SKELETON_ROWS,
}).meta(detailMeta("journal", "i-ph-clock-counter-clockwise"));

/**
 * One migration: where it stands and what can be done (the header), its
 * counts, every captured workspace with the actions it allows, what changes
 * for a moved workspace, and its journal. Every block reads its route, and
 * reads it again when a migration changes (`PLAN_MIGRATION_TOPIC`).
 */
@RegisterPage()
export class SaasPlanMigrationDetailController extends PageController(
  "detail",
  {
    displayName: `${TEXTS}.detail_title`,
    description: `${TEXTS}.detail_description`,
    category: SaasPlanMigrationsController,
    urlSlug: ":id",
    icon: "i-ph-arrows-clockwise",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true, hideHeader: true }),
) {
  static header = Banner({
    fetchUrl: `${DETAIL_API}/header`,
    realtimeTopic: PLAN_MIGRATION_TOPIC,
  }).meta(detailMeta("header", "i-ph-arrows-clockwise"));

  static totals = StatGroup({
    layout: "joined",
    fetchUrl: `${DETAIL_API}/totals`,
    realtimeTopic: PLAN_MIGRATION_TOPIC,
    skeletonCount: TOTALS_COUNT,
    columns: TOTALS_COUNT,
    label: `${DETAIL}.totals`,
  }).meta(detailMeta("totals", "i-ph-squares-four"));

  static workspaces = workspaces;

  static details = Grid({ gap: "1rem" })
    .child(
      "row",
      GridRow()
        .child("changes", changes)
        .child("journal", journal)
        .meta(detailMeta("details_row", "i-ph-rows")),
    )
    .meta(detailMeta("details", "i-ph-layout"));
}
