import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { plansDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { catalogCategory } from "../categories";

const PLANS_PAGE_URL = "/modules/saas/catalog/plans";

const planDeleteModal = CustomComponent("DmsSaasDeletePlanModal");

@RegisterPage()
export class SaasPlansController extends PageController(
  "plans",
  {
    displayName: "$saas.plans.title",
    module: SAAS_MODULE_ID,
    category: catalogCategory,
    icon: "i-ph-stack",
    description: "$saas.plans.description",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(plansDataAPI, {
    caption: "$saas.plans.caption",
    labelKey: "name",
    defaultSort: { field: "order" },
    defaultFilters: [{ accessorKey: "isDeleted", value: "false", mode: "is" }],
    rowActions: {
      add: false,
      edit: false,
      details: false,
      delete: false,
      copyLink: false,
      hasSelection: false,
      custom: [
        {
          label: "$saas.plans.action.edit",
          icon: "i-ph-pencil",
          target: { type: "page", url: `${PLANS_PAGE_URL}/{_id}/edit` },
        },
        {
          label: "$saas.plans.action.delete",
          icon: "i-ph-trash",
          target: {
            type: "modal",
            size: "lg",
            component: planDeleteModal,
            title: "$saas.plans.delete.action_title",
          },
        },
      ],
    },
    customButtons: [
      {
        label: "$saas.plans.migrations.title",
        icon: "i-ph-arrows-clockwise",
        color: "neutral",
        target: { type: "page", url: `${PLANS_PAGE_URL}/migrations` },
      },
      {
        label: "$saas.plans.create",
        icon: "i-ph-plus",
        color: "primary",
        target: { type: "page", url: `${PLANS_PAGE_URL}/new` },
      },
    ],
    formContainer: {
      type: "page",
      pages: {
        new: { urlSlug: "new", customPage: true },
        edit: { urlSlug: ":id/edit", customPage: true },
        view: { urlSlug: ":id/view", customPage: true },
      },
    },
    displays: [
      {
        id: "cards",
        selfManagedData: true,
        capabilities: {
          columnManagement: false,
          filters: false,
          search: false,
          sorting: false,
          tabs: false,
        },
      },
    ],
    defaultDisplay: "cards",
  });
}
