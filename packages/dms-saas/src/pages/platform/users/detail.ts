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

const summary = CustomComponent("DmsSaasUserSummaryCard").meta({
  name: "$saas.users.summary.title",
  icon: "i-ph-identification-card",
});

const tabs = Tab({
  items: [
    {
      label: "$saas.users.tabs.workspaces",
      icon: "i-ph-buildings",
      slot: "workspaces",
    },
    {
      label: "$saas.users.tabs.invoices",
      icon: "i-ph-receipt",
      slot: "invoices",
    },
  ],
})
  .child(
    "workspaceTable",
    TableView(adminUserWorkspacesDataAPI, {
      caption: "$saas.users.workspaces_section",
      rowActions: NO_ROW_ACTIONS,
      routeParamFilters: ROUTE_FILTER_USER,
    }),
    { slot: "workspaces" },
  )
  .child(
    "invoiceTable",
    TableView(adminUserInvoicesDataAPI, {
      caption: "$saas.users.invoices_section",
      rowActions: NO_ROW_ACTIONS,
      routeParamFilters: ROUTE_FILTER_USER,
    }),
    { slot: "invoices" },
  );

const notes = CustomComponent("DmsSaasPlatformNotes")
  .options({ targetType: "user" })
  .meta({
    name: "$saas.notes.title",
    icon: "i-ph-note-pencil",
  });

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
  static layout = VStack({ spacing: "1.5rem", alignment: "stretch" })
    .child("summary", summary)
    .child(
      "body",
      Grid({ gap: "1.5rem" }).child(
        "row",
        GridRow()
          .child("main", tabs, { colSpan: 2 })
          .child(
            "sidebar",
            VStack({ spacing: "1.5rem", alignment: "stretch" }).child(
              "notes",
              notes,
            ),
            { colSpan: 1 },
          ),
      ),
    );
}
