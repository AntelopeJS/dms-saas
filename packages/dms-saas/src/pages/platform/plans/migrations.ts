import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { NavCardGrid, TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { planMigrationsDataAPI } from "../../../data-api";
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
  // The figures, the workspaces to settle and the operator actions all read
  // the migration of the route: blocks fetch fixed URLs, so one component
  // built from the DMS's public components draws the page.
  static migration = CustomComponent("DmsSaasPlanMigrationDetail")
    .options({ endpoint: PLAN_MIGRATIONS_ENDPOINT })
    .meta({
      name: `${PERMISSIONS}.migration_detail`,
      description: `${PERMISSIONS}.migration_detail_description`,
      icon: "i-ph-arrows-clockwise",
    });
}
