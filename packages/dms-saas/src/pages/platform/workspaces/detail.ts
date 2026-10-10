import { INVOICE_ROW_ACTIONS } from "../invoices";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  ActivityFeed,
  FieldRow,
  Grid,
  GridRow,
  KeyValueList,
  Section,
  StatGroup,
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
import { permissionMeta } from "./shared";

const D = "$saas.workspace_detail";
const API = "/api/saas/workspaces/{{params.id}}";
const INVITATION_API = "/api/saas/workspaces/{_instance}/invitations/{_id}";
const FACTS = 5;
const LATEST_INVOICES = 3;

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

// The workspace is the page: its column would repeat on every row.
const WITHOUT_WORKSPACE_COLUMN = {
  items: [
    {
      id: "workspace",
      label: `${D}.tables.this_workspace`,
      columns: { hidden: ["workspaceName"] },
    },
  ],
  defaultView: "workspace",
  layout: "menu" as const,
};

// The same actions as the Invoices page: credit only paid and open invoices.
const invoiceRowActions = {
  ...NO_ROW_ACTIONS,
  custom: INVOICE_ROW_ACTIONS,
};

const invitationRowActions = {
  ...NO_ROW_ACTIONS,
  custom: [
    {
      label: `${D}.invitations.resend`,
      icon: "i-ph-arrow-clockwise",
      target: {
        type: "api" as const,
        url: `${INVITATION_API}/resend`,
        method: "POST" as const,
        successMessage: `${D}.invitations.resend_success`,
      },
      confirm: {
        title: `${D}.invitations.resend_title`,
        description: `${D}.invitations.resend_description`,
        color: "primary" as const,
      },
    },
    {
      label: `${D}.invitations.copy_link`,
      icon: "i-ph-link",
      target: {
        type: "modal" as const,
        size: "lg" as const,
        component: CustomComponent("DmsSaasWorkspaceInvitationLink").meta(
          permissionMeta("invitation_link", "i-ph-link"),
        ),
        title: `${D}.invitations.link_title`,
      },
    },
    {
      label: `${D}.invitations.revoke`,
      icon: "i-ph-x-circle",
      color: "error" as const,
      target: {
        type: "api" as const,
        url: `${INVITATION_API}/revoke`,
        method: "POST" as const,
        successMessage: `${D}.invitations.revoke_success`,
      },
      confirm: {
        title: `${D}.invitations.revoke_title`,
        description: `${D}.invitations.revoke_description`,
        color: "error" as const,
        confirmLabel: `${D}.invitations.revoke`,
      },
    },
  ],
};

const overview = VStack({ spacing: "1.5rem", alignment: "stretch" })
  .child(
    "billingInfo",
    KeyValueList({
      title: `${D}.billing.title`,
      fetchUrl: `${API}/billing-info`,
      columns: 2,
      empty: { title: `${D}.billing.empty` },
    }).meta(permissionMeta("billing_info", "i-ph-identification-card")),
  )
  .child(
    "subscription",
    ActivityFeed({
      title: `${D}.timeline.title`,
      fetchUrl: `${API}/subscription-timeline`,
      groupByDay: false,
      empty: { title: `${D}.timeline.empty` },
    }).meta(
      permissionMeta("subscription_timeline", "i-ph-clock-counter-clockwise"),
    ),
  )
  .child(
    "latestInvoices",
    TableView(invoicesDataAPI, {
      caption: `${D}.invoices.latest`,
      layout: "compact",
      pageSize: LATEST_INVOICES,
      defaultSort: { field: "issuedAt", desc: true },
      views: WITHOUT_WORKSPACE_COLUMN,
      rowActions: invoiceRowActions,
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
  )
  .child(
    "recentActivity",
    ActivityFeed({
      title: `${D}.activity.recent`,
      fetchUrl: `${API}/activity?limit=short`,
      groupByDay: false,
      empty: { title: `${D}.activity.empty` },
    }).meta(permissionMeta("recent_activity", "i-ph-pulse")),
  )
  .meta(permissionMeta("overview", "i-ph-squares-four"));

const members = VStack({ spacing: "1.5rem", alignment: "stretch" })
  .child(
    "memberTable",
    TableView(membersDataAPI, {
      caption: `${D}.members.title`,
      rowActions: NO_ROW_ACTIONS,
      defaultSort: { field: "joinedAt" },
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
  )
  .child(
    "invitationTable",
    TableView(invitationsDataAPI, {
      caption: `${D}.invitations.title`,
      rowActions: invitationRowActions,
      routeParamFilters: ROUTE_FILTER_TENANT,
      emptyStates: { firstRun: { title: `${D}.invitations.empty` } },
    }),
  )
  .meta(permissionMeta("members", "i-ph-users"));

const TAB_ITEMS = [
  { label: `${D}.tabs.overview`, icon: "i-ph-squares-four", slot: "overview" },
  { label: `${D}.tabs.invoices`, icon: "i-ph-receipt", slot: "invoices" },
  {
    label: `${D}.tabs.credit_notes`,
    icon: "i-ph-arrow-u-down-left",
    slot: "creditNotes",
  },
  { label: `${D}.tabs.members`, icon: "i-ph-users", slot: "members" },
  { label: `${D}.tabs.activity`, icon: "i-ph-pulse", slot: "activity" },
];

const tabs = Tab({
  items: TAB_ITEMS,
  badgesUrl: `${API}/tab-counts`,
  persistState: true,
  stateKey: "workspace-tab",
})
  .meta(permissionMeta("tabs", "i-ph-tabs"))
  .child("overview", overview, { slot: "overview" })
  .child(
    "invoiceTable",
    TableView(invoicesDataAPI, {
      caption: `${D}.invoices.title`,
      defaultSort: { field: "issuedAt", desc: true },
      views: WITHOUT_WORKSPACE_COLUMN,
      rowActions: invoiceRowActions,
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
    { slot: "invoices" },
  )
  .child(
    "creditNoteTable",
    TableView(creditNotesDataAPI, {
      caption: `${D}.credit_notes.title`,
      defaultSort: { field: "issuedAt", desc: true },
      views: WITHOUT_WORKSPACE_COLUMN,
      rowActions: NO_ROW_ACTIONS,
      routeParamFilters: ROUTE_FILTER_TENANT,
    }),
    { slot: "creditNotes" },
  )
  .child("members", members, { slot: "members" })
  .child(
    "activity",
    ActivityFeed({
      title: `${D}.activity.title`,
      fetchUrl: `${API}/activity`,
      empty: { title: `${D}.activity.empty` },
    }).meta(permissionMeta("activity", "i-ph-pulse")),
    { slot: "activity" },
  );

const sidebar = VStack({ spacing: "1.5rem", alignment: "stretch" })
  .child(
    "operatorActions",
    CustomComponent("DmsSaasWorkspaceOperatorActions").meta(
      permissionMeta("operator_actions", "i-ph-shield-check"),
    ),
  )
  .child(
    "credit",
    KeyValueList({
      title: `${D}.credit.title`,
      fetchUrl: `${API}/available-credit`,
      dense: true,
      skeletonCount: 1,
      empty: { title: `${D}.credit.empty` },
    }).meta(permissionMeta("available_credit", "i-ph-coins")),
  )
  .child(
    "notes",
    CustomComponent("DmsSaasPlatformNotes")
      .options({ targetType: "workspace" })
      .meta(permissionMeta("notes", "i-ph-note-pencil")),
  )
  .child(
    "danger",
    Section({ title: `${D}.danger.title`, danger: true }).child(
      "suspend",
      FieldRow({
        label: `${D}.danger.suspend_label`,
        description: `${D}.danger.suspend_description`,
      })
        .child(
          "button",
          CustomComponent("DmsSaasWorkspaceSuspendButton").meta(
            permissionMeta("suspend_button", "i-ph-prohibit"),
          ),
        )
        .meta(permissionMeta("suspend_row", "i-ph-prohibit")),
    ),
  )
  .meta(permissionMeta("sidebar", "i-ph-sidebar-simple"));

@RegisterPage()
export class SaasWorkspaceDetailController extends PageController(
  "detail",
  {
    displayName: `${D}.title`,
    description: `${D}.description`,
    category: SaasWorkspacesListController,
    urlSlug: ":id",
    icon: "i-ph-building",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true, hideHeader: true }),
) {
  static header = CustomComponent("DmsSaasWorkspaceDetailHeader").meta(
    permissionMeta("header", "i-ph-building"),
  );

  static facts = StatGroup({
    layout: "joined",
    columns: FACTS,
    skeletonCount: FACTS,
    label: `${D}.facts.label`,
    fetchUrl: `${API}/facts`,
  }).meta(permissionMeta("facts", "i-ph-squares-four"));

  static body = Grid({ gap: "1.5rem" })
    .child(
      "row",
      GridRow()
        .child("main", tabs, { colSpan: 2 })
        .child("sidebar", sidebar, { colSpan: 1 })
        .meta(permissionMeta("body_row", "i-ph-rows")),
    )
    .meta(permissionMeta("body", "i-ph-layout"));
}
