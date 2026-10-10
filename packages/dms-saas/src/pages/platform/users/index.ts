import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { saasUsersDataAPI } from "../../../data-api";
import { SAAS_MODULE_ID } from "../../module";
import { customersCategory } from "../categories";

const USERS_PAGE_SIZE = 25;
const PLATFORM_OWNERS_API = "/api/saas/platform-owners/{_id}";

const USER_TABS = [
  {
    id: "all",
    label: "$saas.users.tabs.all",
    icon: "i-ph-users",
  },
  {
    id: "platform_admins",
    label: "$saas.users.tabs.platform_admins",
    icon: "i-ph-shield-check",
    filter: { accessorKey: "owner", value: "true", mode: "is" },
  },
  {
    id: "unverified",
    label: "$saas.users.tabs.unverified",
    icon: "i-ph-envelope-simple",
    filter: { accessorKey: "isValidated", value: "false", mode: "is" },
  },
];

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
    labelKey: "name",
    searchPlaceholder: "$saas.users.search_placeholder",
    pageSize: USERS_PAGE_SIZE,
    defaultSort: { field: "lastActiveAt", desc: true },
    tabs: USER_TABS,
    footer: {
      countLabel: "$saas.users.footer_count",
    },
    emptyStates: {
      firstRun: {
        title: "$saas.users.empty.title",
        description: "$saas.users.empty.description",
        icon: "i-ph-users",
      },
    },
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      edit: false,
      details: {
        isEnabled: true,
        isVisible: false,
        label: "$saas.users.actions.open",
      },
      custom: [
        {
          label: "$saas.users.actions.promote",
          icon: "i-ph-shield-check",
          rule: { field: "owner", equals: false },
          target: {
            type: "api",
            url: `${PLATFORM_OWNERS_API}/promote`,
            method: "POST",
            successMessage: "$saas.users.platform_role.promoted",
          },
          confirm: { from: `${PLATFORM_OWNERS_API}/promote-confirm` },
        },
        {
          label: "$saas.users.actions.demote",
          icon: "i-ph-shield-slash",
          color: "error",
          rule: { field: "owner", equals: true },
          target: {
            type: "api",
            url: `${PLATFORM_OWNERS_API}/demote`,
            method: "POST",
            successMessage: "$saas.users.platform_role.demoted",
          },
          confirm: { from: `${PLATFORM_OWNERS_API}/demote-confirm` },
        },
      ],
    },
    formContainer: {
      type: "page",
      pages: { details: { urlSlug: ":id", customPage: true } },
    },
  });
}
