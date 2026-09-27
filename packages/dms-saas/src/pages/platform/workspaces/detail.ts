import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  Grid,
  GridRow,
  HStack,
  Tab,
  TableView,
  VStack,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import {
  creditNotesDataAPI,
  invitationsDataAPI,
  invoicesDataAPI,
  membersDataAPI,
} from "../../../data-api";
import { SaasWorkspacesListController } from "./index";

const NO_ROW_ACTIONS = {
  add: false,
  delete: false,
  edit: false,
  details: false,
  duplicate: false,
  archive: false,
  copyLink: false,
} as const;

const ROUTE_FILTER_TENANT = { id: { field: "_instance" } };

const INVITATION_ACTIONS_URL =
  "/api/saas/workspaces/{_instance}/invitations/{_id}";

const invitationLink = CustomComponent("DmsSaasWorkspaceInvitationLink");

const invitationTable = TableView(invitationsDataAPI, {
  caption: "$saas.workspaces.invitations.caption",
  rowActions: {
    ...NO_ROW_ACTIONS,
    custom: [
      {
        label: "$saas.workspaces.invitations.action.resend",
        icon: "i-ph-arrow-clockwise",
        target: {
          type: "api",
          url: `${INVITATION_ACTIONS_URL}/resend`,
          method: "POST",
          successMessage: "$saas.workspaces.invitations.action.resend_success",
          confirm: {
            title: "$saas.workspaces.invitations.action.resend_confirm_title",
            description:
              "$saas.workspaces.invitations.action.resend_confirm_description",
            confirmColor: "primary",
          },
        },
      },
      {
        label: "$saas.workspaces.invitations.action.copy_link",
        icon: "i-ph-link",
        target: {
          type: "modal",
          size: "lg",
          component: invitationLink,
          title: "$saas.workspaces.invitations.link.title",
          description: "$saas.workspaces.invitations.link.description",
        },
      },
    ],
  },
  routeParamFilters: ROUTE_FILTER_TENANT,
});

const detailHeader = CustomComponent("DmsSaasWorkspaceDetailHeader").meta({
  name: "$saas.workspaces.detail",
  icon: "i-ph-building",
});

const joinButton = CustomComponent("DmsSaasWorkspaceJoinButton").meta({
  name: "$saas.workspaces.join.button",
  icon: "i-ph-user-plus",
});

const summary = CustomComponent("DmsSaasWorkspaceSummaryCard").meta({
  name: "$saas.workspaces.summary.title",
  icon: "i-ph-building",
});

const billing = CustomComponent("DmsSaasWorkspaceBillingInfo").meta({
  name: "$saas.workspaces.billing_section",
  icon: "i-ph-credit-card",
});

const suspendButton = CustomComponent("DmsSaasWorkspaceSuspendButton").meta({
  name: "$saas.workspaces.admin.suspend",
  icon: "i-ph-prohibit",
});

const compButton = CustomComponent("DmsSaasWorkspaceCompAccessButton").meta({
  name: "$saas.workspaces.admin.comp.title",
  icon: "i-ph-gift",
});

const operatorActions = CustomComponent("DmsSaasWorkspaceOperatorActions").meta(
  {
    name: "$saas.workspaces.operator.title",
    icon: "i-ph-shield-check",
  },
);

const tabs = Tab({
  items: [
    {
      label: "$saas.workspaces.tabs.invoices",
      icon: "i-ph-receipt",
      slot: "invoices",
    },
    {
      label: "$saas.workspaces.tabs.credit_notes",
      icon: "i-ph-arrow-u-down-left",
      slot: "creditNotes",
    },
    {
      label: "$saas.workspaces.tabs.members",
      icon: "i-ph-users",
      slot: "members",
    },
  ],
})
  .child(
    "invoiceTable",
    TableView(invoicesDataAPI, {
      caption: "$saas.invoices.title",
      rowActions: NO_ROW_ACTIONS,
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
    { slot: "invoices" },
  )
  .child(
    "creditNoteTable",
    TableView(creditNotesDataAPI, {
      caption: "$saas.credit_notes.title",
      rowActions: NO_ROW_ACTIONS,
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
    { slot: "creditNotes" },
  )
  .child(
    "members",
    VStack({ spacing: "1.5rem", alignment: "stretch" })
      .child(
        "memberTable",
        TableView(membersDataAPI, {
          caption: "$saas.workspaces.tabs.members",
          rowActions: NO_ROW_ACTIONS,
          routeParamFilters: ROUTE_FILTER_TENANT,
        }),
      )
      .child("invitationTable", invitationTable),
    { slot: "members" },
  );

const notes = CustomComponent("DmsSaasPlatformNotes")
  .options({ targetType: "workspace" })
  .meta({
    name: "$saas.notes.title",
    icon: "i-ph-note-pencil",
  });

@RegisterPage()
export class SaasWorkspaceDetailController extends PageController(
  "detail",
  {
    displayName: "$saas.workspaces.detail",
    description: "$saas.workspaces.detail_description",
    category: SaasWorkspacesListController,
    urlSlug: ":id",
    icon: "i-ph-building",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true, hideHeader: true }),
) {
  static layout = VStack({ spacing: "1.5rem", alignment: "stretch" })
    .child(
      "header",
      HStack({ alignment: "center", spacing: "0.75rem", wrap: true })
        .child("title", detailHeader)
        .child("compButton", compButton)
        .child("suspendButton", suspendButton)
        .child("joinButton", joinButton),
    )
    .child("summary", summary)
    .child(
      "body",
      Grid({ gap: "1.5rem" }).child(
        "row",
        GridRow()
          .child("main", tabs, { colSpan: 2 })
          .child(
            "sidebar",
            VStack({ spacing: "1.5rem", alignment: "stretch" })
              .child("operatorActions", operatorActions)
              .child("billing", billing)
              .child("notes", notes),
            { colSpan: 1 },
          ),
      ),
    );
}
