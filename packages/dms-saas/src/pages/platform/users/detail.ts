import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  Grid,
  GridRow,
  Tab,
  TableView,
  VStack,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import {
  adminUserInvoicesDataAPI,
  adminUserWorkspacesDataAPI,
} from "../../../data-api";
import { SaasUsersListController } from "./index";

const PERMISSIONS = "$saas.permissions.users";
const SPACING = "1.5rem";
const WORKSPACE_DETAIL_URL = "/modules/saas/customers/workspaces/{_instance}";

const NO_ROW_ACTIONS = {
  add: false,
  delete: false,
  edit: false,
  details: false,
  duplicate: false,
  archive: false,
  copyLink: false,
} as const;

const ROUTE_FILTER_USER = { id: { field: "userId" } };

function described(key: string, icon: string) {
  return {
    name: `${PERMISSIONS}.${key}`,
    description: `${PERMISSIONS}.${key}_description`,
    icon,
  };
}

const summary = CustomComponent("DmsSaasUserSummaryCard").meta(
  described("profile", "i-ph-identification-card"),
);

const workspaceTable = TableView(adminUserWorkspacesDataAPI, {
  layout: "compact",
  labelKey: "name",
  rowActions: {
    ...NO_ROW_ACTIONS,
    custom: [
      {
        label: "$saas.users.workspaces.open",
        icon: "i-ph-arrow-square-out",
        isDefault: true,
        target: { type: "page", url: WORKSPACE_DETAIL_URL },
      },
    ],
  },
  routeParamFilters: ROUTE_FILTER_USER,
  defaultSort: { field: "joinedAt", desc: false },
  emptyStates: {
    firstRun: {
      title: "$saas.users.workspaces.empty_title",
      description: "$saas.users.workspaces.empty_description",
      icon: "i-ph-buildings",
    },
  },
}).meta(described("workspaces", "i-ph-buildings"));

const billingTable = TableView(adminUserInvoicesDataAPI, {
  layout: "compact",
  labelKey: "number",
  rowActions: {
    ...NO_ROW_ACTIONS,
    custom: [
      {
        label: "$saas.users.billing.open_invoice",
        icon: "i-ph-arrow-square-out",
        isDefault: true,
        rule: { field: "hostedInvoiceUrl", notEquals: null },
        target: { type: "external", url: "{hostedInvoiceUrl}", newTab: true },
      },
      {
        label: "$saas.users.billing.download_pdf",
        icon: "i-ph-file-pdf",
        rule: { field: "invoicePdfUrl", notEquals: null },
        target: { type: "external", url: "{invoicePdfUrl}", newTab: true },
      },
    ],
  },
  routeParamFilters: ROUTE_FILTER_USER,
  defaultSort: { field: "issuedAt", desc: true },
  footer: { hint: "$saas.users.billing.hint" },
  emptyStates: {
    firstRun: {
      title: "$saas.users.billing.empty_title",
      description: "$saas.users.billing.empty_description",
      icon: "i-ph-receipt",
    },
  },
}).meta(described("billing", "i-ph-receipt"));

const segmentMatches = CustomComponent("DmsSaasUserSegmentMatches").meta(
  described("segments", "i-ph-funnel"),
);

const tabs = Tab({
  persistState: true,
  stateKey: "tab",
  items: [
    {
      label: "$saas.users.tabs.workspaces",
      icon: "i-ph-buildings",
      slot: "workspaces",
    },
    {
      label: "$saas.users.tabs.billing",
      icon: "i-ph-receipt",
      slot: "billing",
    },
    {
      label: "$saas.users.tabs.segments",
      icon: "i-ph-funnel",
      slot: "segments",
    },
  ],
})
  .child("workspaceTable", workspaceTable, { slot: "workspaces" })
  .child("billingTable", billingTable, { slot: "billing" })
  .child("segmentMatches", segmentMatches, { slot: "segments" });

const security = CustomComponent("DmsSaasUserSecurityCard").meta(
  described("security", "i-ph-lock-key"),
);

const notes = CustomComponent("DmsSaasPlatformNotes")
  .options({ targetType: "user" })
  .meta(described("notes", "i-ph-note-pencil"));

const platformRole = CustomComponent("DmsSaasUserPlatformRoleCard").meta(
  described("platform_role", "i-ph-shield-check"),
);

@RegisterPage()
export class SaasUserDetailController extends PageController(
  "detail",
  {
    displayName: "$saas.users.detail",
    description: "$saas.users.detail_description",
    category: SaasUsersListController,
    urlSlug: ":id",
    icon: "i-ph-user",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static layout = VStack({ spacing: SPACING, alignment: "stretch" })
    .child("summary", summary)
    .child(
      "body",
      Grid({ gap: SPACING }).child(
        "row",
        GridRow()
          .child("main", tabs, { colSpan: 2 })
          .child(
            "sidebar",
            VStack({ spacing: SPACING, alignment: "stretch" })
              .child("security", security)
              .child("notes", notes)
              .child("platformRole", platformRole),
            { colSpan: 1 },
          ),
      ),
    );
}
