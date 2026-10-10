import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { StatGroup, TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types";
import type {
  ActionTarget,
  ActionTargetSerialized,
} from "@antelopejs/interface-dms/base/types/action-target";
import type { CustomRowAction } from "@antelopejs/interface-dms/base/types/row-action";
import { plansDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { catalogCategory } from "../categories";

const TEXTS = "$saas.catalog.plans";
const PERMISSIONS = "$saas.permissions.catalog";
export const PLANS_PAGE_URL = "/modules/saas/catalog/plans";
const PLAN_MIGRATIONS_PAGE_URL = "/modules/saas/catalog/plan-migrations";
const WORKSPACES_PAGE_URL = "/modules/saas/customers/workspaces";
const PLANS_ENDPOINT = "/api/saas/plans";
const PLAN_DIALOGS_ENDPOINT = "/api/saas/plan-dialogs";
const PLAN_CARDS_DISPLAY_ID = "saas:plan-cards";
const RETIRE_MODAL_SIZE = "3xl";
const CATALOGUE_STAT_COUNT = 4;

const retirePlanModal = CustomComponent("DmsSaasRetirePlanModal").meta({
  name: `${PERMISSIONS}.retire_plan`,
  description: `${PERMISSIONS}.retire_plan_description`,
  icon: "i-ph-archive",
});

type PlanTableOptions = NonNullable<
  Parameters<typeof TableView<typeof plansDataAPI>>[1]
>;
type PlanRowActions = NonNullable<PlanTableOptions["rowActions"]>["custom"];

const isInUse = { field: "workspaceCount", notEquals: 0 } as const;
const isUnused = { field: "workspaceCount", equals: 0 } as const;

/**
 * The menu of a plan, the same in the table and on the cards: duplicate,
 * see its workspaces, open it in Stripe, stop or resume selling it, retire
 * it (moving its workspaces) or, once nobody uses it, delete it.
 */
/** A plan menu entry, keyed so the cards find the one a control stands for. */
interface PlanAction extends CustomRowAction {
  key: string;
}

const PLAN_ACTIONS: PlanAction[] = [
  {
    key: "duplicate",
    label: `${TEXTS}.action.duplicate`,
    icon: "i-ph-copy",
    target: { type: "page", url: `${PLANS_PAGE_URL}/new?duplicate={_id}` },
  },
  {
    key: "view_workspaces",
    label: `${TEXTS}.action.view_workspaces`,
    icon: "i-ph-buildings",
    target: { type: "page", url: `${WORKSPACES_PAGE_URL}?plan={_id}` },
    rule: isInUse,
  },
  {
    key: "open_stripe",
    label: `${TEXTS}.action.open_stripe`,
    icon: "i-ph-stripe-logo",
    target: { type: "external", url: "{stripeProductUrl}", newTab: true },
    rule: { field: "stripeProductUrl", notEquals: null },
  },
  {
    key: "stop_selling",
    label: `${TEXTS}.action.stop_selling`,
    icon: "i-ph-pause",
    color: "warning",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{_id}`,
      method: "PUT",
      body: { isActive: false },
      successMessage: `${TEXTS}.action.stop_selling_success`,
    },
    confirm: { from: `${PLAN_DIALOGS_ENDPOINT}/{_id}/stop-selling` },
    rule: { field: "isActive", equals: true },
  },
  {
    key: "put_on_sale",
    label: `${TEXTS}.action.put_on_sale`,
    icon: "i-ph-play",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{_id}`,
      method: "PUT",
      body: { isActive: true },
      successMessage: `${TEXTS}.action.put_on_sale_success`,
    },
    rule: { field: "isActive", equals: false },
  },
  {
    key: "retire",
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
    key: "delete",
    label: `${TEXTS}.action.delete`,
    icon: "i-ph-trash",
    color: "error",
    target: {
      type: "api",
      url: `${PLANS_ENDPOINT}/{_id}`,
      method: "DELETE",
      successMessage: `${TEXTS}.action.delete_success`,
    },
    confirm: { from: `${PLAN_DIALOGS_ENDPOINT}/{_id}/delete` },
    rule: isUnused,
  },
];

const PLAN_ROW_ACTIONS: CustomRowAction[] = PLAN_ACTIONS.map(
  ({ key: _key, ...action }) => action,
);

function serializeTarget(target: ActionTarget): ActionTargetSerialized {
  if (target.type === "modal" || target.type === "drawer") {
    return { ...target, component: target.component.serializeSync() };
  }
  return target;
}

/**
 * The plan menu as the cards display receives it: the table's own actions,
 * serialized, so a card runs them through the table (confirmation, request,
 * refresh) exactly as the grid does.
 */
const PLAN_CARD_ACTIONS = PLAN_ACTIONS.map((action) => ({
  ...action,
  target: serializeTarget(action.target),
}));

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
        target: { type: "page", url: PLAN_MIGRATIONS_PAGE_URL },
      },
      {
        label: `${TEXTS}.create`,
        icon: "i-ph-plus",
        color: "primary",
        target: { type: "page", url: `${PLANS_PAGE_URL}/new` },
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
    labelKey: "name",
    searchPlaceholder: `${TEXTS}.search`,
    defaultSort: { field: "order" },
    defaultFilters: [{ accessorKey: "isDeleted", value: "false", mode: "is" }],
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
      copyLink: false,
      hasSelection: false,
      // The rules read listed values (`workspaceCount` is a number on the
      // row), which the controller types as the getters computing them.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions
      custom: PLAN_ROW_ACTIONS as unknown as PlanRowActions,
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
            to: `${PLANS_PAGE_URL}/new`,
            icon: "i-ph-plus",
          },
        ],
      },
      filtered: {
        title: `${TEXTS}.empty.filtered_title`,
      },
      error: {
        title: `${TEXTS}.empty.error_title`,
        description: `${TEXTS}.empty.error_description`,
      },
    },
    displays: [
      {
        id: PLAN_CARDS_DISPLAY_ID,
        component: CustomComponent("DmsSaasPlanCardsDisplay"),
        options: { actions: PLAN_CARD_ACTIONS },
        capabilities: {
          columnManagement: false,
          filters: false,
          sorting: false,
        },
      },
    ],
    defaultDisplay: PLAN_CARDS_DISPLAY_ID,
  });
}
