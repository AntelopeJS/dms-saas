import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  StatGroup,
  TableView,
  type TableViewTab,
  type TableViewView,
} from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { workspacesDataAPI } from "../../../data-api";
import { BILLING_STATES } from "../../../db";
import { WORKSPACE_VIEW_IDS } from "../../../metrics/headline-items";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";
import { WORKSPACES_PAGE_PATH } from "../paths";
import { CREATE_WORKSPACE_BUTTON, permissionMeta } from "./shared";

const W = "$saas.workspaces";
const ROW = `${W}.row_actions`;
const ROW_API = "/api/saas/workspaces/{_id}";
// Money and access dialogs open on the workspace's own page, where its
// figures stand next to them: the row action names the dialog to open.
const ROW_DETAIL = `${WORKSPACES_PAGE_PATH}/{_id}?action=`;
const HEADLINE_FIGURES = 4;
const PAGE_SIZE = 25;
// MRR is stored in minor units: 500.00 in the reporting currency.
const MRR_OVER_500_MINOR = "50000";

const STATUS_TABS: TableViewTab[] = BILLING_STATES.map((state) => ({
  id: state,
  label: `$saas.status.workspace.${state}`,
  filter: { accessorKey: "billingState", value: state, mode: "is" },
  // Past due is the queue operators work through: the menu shows its size.
  navBadge: state === "past_due",
}));

const VIEWS: TableViewView[] = [
  {
    id: WORKSPACE_VIEW_IDS.complimentaryEnding,
    label: `${W}.views.complimentary_ending`,
    icon: "i-ph-gift",
    tone: "warning",
    count: true,
    filters: [
      { accessorKey: "renewalKind", value: "free_until", mode: "is" },
      { accessorKey: "renewsAt", value: "{{now+7d}}", mode: "less_than" },
    ],
    sort: [{ field: "renewsAt" }],
  },
  {
    id: WORKSPACE_VIEW_IDS.pastDueOverSevenDays,
    label: `${W}.views.past_due_7_days`,
    icon: "i-ph-warning-circle",
    tone: "error",
    count: true,
    filters: [
      { accessorKey: "billingState", value: "past_due", mode: "is" },
      { accessorKey: "stateSince", value: "{{now-7d}}", mode: "less_than" },
    ],
    sort: [{ field: "renewsAt" }],
  },
  {
    id: WORKSPACE_VIEW_IDS.trialsEnding,
    label: `${W}.views.trials_ending`,
    icon: "i-ph-hourglass-medium",
    tone: "info",
    count: true,
    filters: [
      { accessorKey: "renewalKind", value: "trial_ends", mode: "is" },
      { accessorKey: "renewsAt", value: "{{now+14d}}", mode: "less_than" },
    ],
    sort: [{ field: "renewsAt" }],
  },
  {
    id: WORKSPACE_VIEW_IDS.ownerNeverJoined,
    label: `${W}.views.owner_never_joined`,
    icon: "i-ph-user-circle-dashed",
    count: true,
    filters: [{ accessorKey: "ownerNeverJoined", value: "true", mode: "is" }],
    sort: [{ field: "createdAt", desc: true }],
  },
  {
    id: WORKSPACE_VIEW_IDS.mrrOver500,
    label: `${W}.views.mrr_over_500`,
    icon: "i-ph-currency-circle-dollar",
    count: true,
    filters: [
      {
        accessorKey: "mrrMinor",
        value: MRR_OVER_500_MINOR,
        mode: "greater_than",
      },
    ],
    sort: [{ field: "mrrMinor", desc: true }],
  },
];

@RegisterPage()
export class SaasWorkspacesListController extends PageController(
  "workspaces",
  {
    displayName: `${W}.title`,
    module: SAAS_MODULE_ID,
    category: customersCategory,
    icon: "i-ph-buildings",
    description: `${W}.description`,
    order: 0,
  },
  DefaultLayout({ fullWidth: true, headerActions: [CREATE_WORKSPACE_BUTTON] }),
) {
  static headline = StatGroup({
    layout: "cards",
    columns: HEADLINE_FIGURES,
    skeletonCount: HEADLINE_FIGURES,
    label: `${W}.headline.label`,
    fetchUrl: "/api/saas/workspaces/directory-headline",
  }).meta(permissionMeta("list_headline", "i-ph-squares-four"));

  static table = TableView(workspacesDataAPI, {
    caption: `${W}.caption`,
    searchPlaceholder: `${W}.search_placeholder`,
    labelKey: "name",
    pageSize: PAGE_SIZE,
    tabs: STATUS_TABS,
    views: { items: VIEWS, layout: "menu" },
    quickFilters: [
      { field: "planName", icon: "i-ph-stack" },
      { field: "ownerStatus", icon: "i-ph-user-circle" },
    ],
    defaultSort: { field: "createdAt", desc: true },
    queryParamFilters: { plan: { field: "planId" } },
    footer: { countLabel: `${W}.footer_count` },
    emptyStates: {
      firstRun: {
        title: `${W}.empty.first_run_title`,
        description: `${W}.empty.first_run_description`,
        icon: "i-ph-buildings",
      },
      filtered: {
        title: `${W}.empty.filtered_title`,
        description: `${W}.empty.filtered_description`,
      },
    },
    rowActions: {
      add: false,
      edit: false,
      delete: false,
      duplicate: false,
      archive: false,
      copyLink: true,
      details: { isEnabled: true, label: `${ROW}.open` },
      custom: [
        {
          label: `${ROW}.grant_free_access`,
          icon: "i-ph-gift",
          rule: { field: "billingState", notIn: ["cancelled"] },
          target: { type: "page", url: `${ROW_DETAIL}complimentary` },
        },
        {
          label: `${ROW}.join`,
          icon: "i-ph-user-plus",
          target: {
            type: "api",
            url: `${ROW_API}/join`,
            method: "POST",
            successMessage: "$saas.workspace_detail.join.success",
          },
          confirm: { from: `${ROW_API}/join-confirmation` },
        },
        {
          label: `${ROW}.suspend`,
          icon: "i-ph-prohibit",
          color: "error",
          rule: { field: "billingState", notIn: ["suspended", "cancelled"] },
          target: { type: "page", url: `${ROW_DETAIL}suspend` },
        },
      ],
    },
    formContainer: {
      type: "page",
      pages: { details: { urlSlug: ":id", customPage: true } },
    },
  });
}
