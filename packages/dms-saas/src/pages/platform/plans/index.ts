import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { StatGroup, TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  CARDS_DISPLAY_ID,
  TABLE_DISPLAY_ID,
} from "@antelopejs/interface-dms/base/table-view";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types";
import type { CustomRowAction } from "@antelopejs/interface-dms/base/types/row-action";
import { plansDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { catalogCategory } from "../categories";
import {
  PLANS_PAGE_PATH,
  PLAN_MIGRATIONS_PAGE_PATH,
  WORKSPACES_PAGE_PATH,
} from "../paths";

const TEXTS = "$saas.catalog.plans";
const PERMISSIONS = "$saas.permissions.catalog";
const PLANS_ENDPOINT = "/api/saas/plans";
const PLAN_DIALOGS_ENDPOINT = "/api/saas/plan-dialogs";
const RETIRE_MODAL_SIZE = "3xl";
const CATALOGUE_STAT_COUNT = 4;
// The cards draw a selection checkbox exactly when the grid does.
const HAS_SELECTION = false;

const retirePlanModal = CustomComponent("DmsSaasRetirePlanModal").meta({
  name: `${PERMISSIONS}.retire_plan`,
  description: `${PERMISSIONS}.retire_plan_description`,
  icon: "i-ph-archive",
});

type PlanTableOptions = NonNullable<
  Parameters<typeof TableView<typeof plansDataAPI>>[1]
>;
type PlanRowActions = NonNullable<PlanTableOptions["rowActions"]>["custom"];

const isInUse = { field: "boundWorkspaceCount", notEquals: 0 } as const;
const isUnused = { field: "boundWorkspaceCount", equals: 0 } as const;

/**
 * The menu of a plan, the same in the table and on the cards (which find the
 * one a control stands for by its `id`): duplicate,
 * see its workspaces, open it in Stripe, stop or resume selling it, retire
 * it (moving its workspaces) or, once nobody uses it, delete it.
 */
const PLAN_ACTIONS: CustomRowAction[] = [
  {
    id: "duplicate",
    label: `${TEXTS}.action.duplicate`,
    icon: "i-ph-copy",
    target: {
      type: "page",
      url: `${PLANS_PAGE_PATH}/new?duplicate={{row._id}}`,
    },
  },
  {
    id: "view_workspaces",
    label: `${TEXTS}.action.view_workspaces`,
    icon: "i-ph-buildings",
    target: { type: "page", url: `${WORKSPACES_PAGE_PATH}?plan={{row._id}}` },
    rule: isInUse,
  },
  {
    id: "open_stripe",
    label: `${TEXTS}.action.open_stripe`,
    icon: "i-ph-stripe-logo",
    target: { type: "external", url: "{{row.stripeProductUrl}}", newTab: true },
    rule: { field: "stripeProductUrl", notEquals: null },
  },
  {
    id: "stop_selling",
    label: `${TEXTS}.action.stop_selling`,
    icon: "i-ph-pause",
    color: "warning",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{{row._id}}`,
      method: "PUT",
      body: { isActive: false },
      successMessage: `${TEXTS}.action.stop_selling_success`,
    },
    confirm: { from: `${PLAN_DIALOGS_ENDPOINT}/{{row._id}}/stop-selling` },
    rule: { field: "isActive", equals: true },
  },
  {
    id: "put_on_sale",
    label: `${TEXTS}.action.put_on_sale`,
    icon: "i-ph-play",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{{row._id}}`,
      method: "PUT",
      body: { isActive: true },
      successMessage: `${TEXTS}.action.put_on_sale_success`,
    },
    rule: { field: "isActive", equals: false },
  },
  {
    id: "retire",
    label: `${TEXTS}.action.retire`,
    icon: "i-ph-archive",
    color: "warning",
    target: {
      type: "modal",
      size: RETIRE_MODAL_SIZE,
      component: retirePlanModal,
      title: `${TEXTS}.action.retire`,
    },
    rule: isInUse,
  },
  {
    id: "delete",
    label: `${TEXTS}.action.delete`,
    icon: "i-ph-trash",
    color: "error",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{{row._id}}`,
      method: "DELETE",
      successMessage: `${TEXTS}.action.delete_success`,
    },
    confirm: { from: `${PLAN_DIALOGS_ENDPOINT}/{{row._id}}/delete` },
    rule: isUnused,
  },
];

@RegisterPage()
export class SaasPlansController extends PageController(
  "plans",
  {
    displayName: `${TEXTS}.title`,
    module: SAAS_MODULE_ID,
    category: catalogCategory,
    icon: "i-ph-stack",
    description: `${TEXTS}.description`,
    order: 0,
  },
  DefaultLayout({
    fullWidth: true,
    headerActions: [
      {
        label: `${TEXTS}.migrations_button`,
        icon: "i-ph-arrows-clockwise",
        color: "neutral",
        variant: ButtonVariant.outline,
        target: { type: "page", url: PLAN_MIGRATIONS_PAGE_PATH },
      },
      {
        label: `${TEXTS}.create`,
        icon: "i-ph-plus",
        color: "primary",
        target: { type: "page", url: `${PLANS_PAGE_PATH}/new` },
      },
    ],
  }),
) {
  static stats = StatGroup({
    fetchUrl: `${PLANS_ENDPOINT}/summary`,
    skeletonCount: CATALOGUE_STAT_COUNT,
    label: `${TEXTS}.stats.label`,
  }).meta({
    name: `${PERMISSIONS}.stats`,
    description: `${PERMISSIONS}.stats_description`,
    icon: "i-ph-squares-four",
  });

  static table = TableView(plansDataAPI, {
    realtimeScope: "global",
    labelKey: "name",
    searchPlaceholder: `${TEXTS}.search`,
    defaultSort: { field: "order" },
    reorder: { field: "order" },
    tabs: [
      {
        id: "on_sale",
        label: `${TEXTS}.tabs.on_sale`,
        icon: "i-ph-storefront",
        filter: { accessorKey: "isActive", value: "true", mode: "is" },
      },
      {
        id: "legacy",
        label: `${TEXTS}.tabs.legacy`,
        icon: "i-ph-clock-counter-clockwise",
        filter: { accessorKey: "isActive", value: "false", mode: "is" },
      },
      { id: "all", label: `${TEXTS}.tabs.all`, icon: "i-ph-stack" },
    ],
    rowActions: {
      add: false,
      edit: { isEnabled: true, label: `${TEXTS}.action.edit` },
      details: false,
      delete: false,
      // "Duplicate as new plan" opens the editor prefilled instead.
      duplicate: false,
      copyLink: false,
      hasSelection: HAS_SELECTION,
      // The rules read listed values (`boundWorkspaceCount` is a number on the
      // row), which the controller types as the getters computing them.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions
      custom: PLAN_ACTIONS as unknown as PlanRowActions,
    },
    formContainer: {
      type: "page",
      pages: {
        new: { urlSlug: "new", customPage: true },
        edit: { urlSlug: ":id/edit", customPage: true },
      },
    },
    emptyStates: {
      firstRun: {
        title: `${TEXTS}.empty.title`,
        description: `${TEXTS}.empty.description`,
        icon: "i-ph-stack",
        actions: [
          {
            label: `${TEXTS}.create`,
            to: `${PLANS_PAGE_PATH}/new`,
            icon: "i-ph-plus",
          },
        ],
      },
      // A tab narrows the rows as a search does: the words fit both.
      filtered: {
        title: `${TEXTS}.empty.filtered_title`,
        description: `${TEXTS}.empty.filtered_description`,
      },
      error: {
        title: `${TEXTS}.empty.error_title`,
        description: `${TEXTS}.empty.error_description`,
      },
    },
    displays: [
      { id: TABLE_DISPLAY_ID },
      { id: CARDS_DISPLAY_ID, capabilities: { filters: false } },
    ],
    defaultDisplay: CARDS_DISPLAY_ID,
    card: {
      component: CustomComponent("DmsSaasPlanCard").options({
        selectable: HAS_SELECTION,
      }),
    },
  });
}
