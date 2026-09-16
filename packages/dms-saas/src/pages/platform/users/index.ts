import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { saasUsersDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

@RegisterPage()
export class SaasUsersListController extends PageController(
  "users",
  {
    displayName: "$saas.users.title",
    module: SAAS_MODULE_ID,
    category: customersCategory,
    icon: "i-ph-users",
    description: "$saas.users.description",
    order: 10,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(saasUsersDataAPI, {
    caption: "$saas.users.caption",
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      details: { isEnabled: true, isVisible: true },
      edit: false,
      custom: [
        {
          label: "$saas.platform_owners.actions.promote",
          icon: "i-ph-shield-check",
          rule: { field: "owner", equals: false },
          target: {
            type: "api",
            url: "/api/saas/platform-owners/{_id}/promote",
            method: "POST",
            successMessage: "$saas.platform_owners.promoted",
            confirm: {
              title: "$saas.platform_owners.confirm_promote.title",
              description: "$saas.platform_owners.confirm_promote.description",
              confirmColor: "primary",
            },
          },
        },
        {
          label: "$saas.platform_owners.actions.demote",
          icon: "i-ph-shield-slash",
          rule: { field: "owner", equals: true },
          target: {
            type: "api",
            url: "/api/saas/platform-owners/{_id}/demote",
            method: "POST",
            successMessage: "$saas.platform_owners.demoted",
            confirm: {
              title: "$saas.platform_owners.confirm_demote.title",
              description: "$saas.platform_owners.confirm_demote.description",
              confirmColor: "error",
            },
          },
        },
      ],
    },
    formContainer: {
      type: "page",
      pages: { view: { urlSlug: ":id", customPage: true } },
    },
  });
}
