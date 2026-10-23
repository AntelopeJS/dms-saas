import {
  PageController,
  RegisterPage,
  workspaceSettingsCategory,
} from "@antelopejs/interface-dms/page";
import {
  Banner,
  Card,
  Grid,
  GridRow,
  KeyValueList,
  Section,
  TableView,
  VStack,
} from "@antelopejs/interface-dms/base";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { tenantBillingPage } from "@antelopejs/interface-dms-saas/pages";
import { tenantInvoicesDataAPI } from "../../data-api";
import { blockMeta } from "../block-meta";

const KEY_PREFIX = "$saas.tenant_billing";
const PERMISSION_PREFIX = "$saas.permissions.billing_page";
const NEXT_INVOICE_ENDPOINT = "/api/saas/tenant/upcoming-invoice";
const COMPLIMENTARY_BANNER_ENDPOINT = "/api/saas/tenant/complimentary-banner";
const NEXT_INVOICE_SKELETON_ROWS = 6;
const OVERVIEW_GAP = "1rem";
// Two cards side by side need about this much each; below it the grid stacks
// them in one column.
const OVERVIEW_MIN_COLUMN_WIDTH = "360px";

/** Name, description and icon of a block as the roles editor lists it. */
function permissionMeta(key: string, icon: string) {
  return blockMeta(PERMISSION_PREFIX, key, icon);
}

const INVOICE_TABS = [
  { id: "all", label: `${KEY_PREFIX}.invoices.tabs.all` },
  {
    id: "invoices",
    label: `${KEY_PREFIX}.invoices.tabs.invoices`,
    filter: { accessorKey: "documentType", value: "invoice", mode: "is" },
  },
  {
    id: "credit_notes",
    label: `${KEY_PREFIX}.invoices.tabs.credit_notes`,
    filter: { accessorKey: "documentType", value: "credit_note", mode: "is" },
  },
];

const planCard = CustomComponent("DmsSaasTenantPlanCard").meta(
  permissionMeta("plan", "i-ph-stack"),
);

/** Stripe's preview of the next invoice; its route requires this block. */
export const nextInvoice = Card({
  title: `${KEY_PREFIX}.next_invoice.title`,
  description: `${KEY_PREFIX}.next_invoice.description`,
})
  .child(
    "lines",
    KeyValueList({
      card: false,
      fetchUrl: NEXT_INVOICE_ENDPOINT,
      skeletonCount: NEXT_INVOICE_SKELETON_ROWS,
      empty: {
        title: `${KEY_PREFIX}.next_invoice.empty_title`,
        description: `${KEY_PREFIX}.next_invoice.empty_description`,
      },
    }),
  )
  .meta(permissionMeta("next_invoice", "i-ph-receipt"));

const paymentMethod = CustomComponent("DmsSaasPaymentMethodCard").meta(
  permissionMeta("payment_method", "i-ph-credit-card"),
);

const refundButton = CustomComponent("DmsSaasRefundButton").meta(
  permissionMeta("money_back", "i-ph-arrow-counter-clockwise"),
);

/** Every invoice and credit note of the workspace, newest first. */
const invoiceTable = TableView(tenantInvoicesDataAPI, {
  caption: `${KEY_PREFIX}.invoices.caption`,
  layout: "compact",
  tabs: INVOICE_TABS,
  defaultSort: { field: "issuedAt", desc: true },
  emptyStates: {
    firstRun: {
      title: `${KEY_PREFIX}.invoices.empty_title`,
      description: `${KEY_PREFIX}.invoices.empty_description`,
      icon: "i-ph-receipt",
    },
    error: {
      title: `${KEY_PREFIX}.invoices.error_title`,
      description: `${KEY_PREFIX}.invoices.error_description`,
    },
  },
  // The page bypasses the tenant access gate; without this mirror the
  // table's own data routes still 403 and the invoices of a suspended
  // workspace render empty on the one page meant to settle them.
  bypassTenantAccessGate: true,
  rowActions: {
    add: false,
    copyLink: true,
    delete: false,
    duplicate: false,
    details: { isEnabled: true, isVisible: true },
    edit: false,
    custom: [
      {
        label: `${KEY_PREFIX}.pay.action`,
        icon: "i-ph-credit-card",
        rule: {
          and: [
            { field: "documentType", equals: "invoice" },
            { field: "status", equals: "open" },
          ],
        },
        isVisible: true,
        showLabel: true,
        color: "primary",
        target: {
          type: "modal",
          size: "sm",
          title: `${KEY_PREFIX}.pay.action`,
          component: CustomComponent("DmsSaasPayInvoiceModal").meta(
            permissionMeta("pay_invoice", "i-ph-credit-card"),
          ),
        },
      },
      {
        label: "$saas.invoices.actions.download_pdf",
        icon: "i-ph-file-pdf",
        rule: { field: "invoicePdfUrl", notEquals: null },
        target: {
          type: "external",
          url: "{{row.invoicePdfUrl}}",
          newTab: true,
        },
      },
      {
        label: "$saas.invoices.actions.open_on_stripe",
        icon: "i-ph-arrow-square-out",
        rule: { field: "hostedInvoiceUrl", notEquals: null },
        target: {
          type: "external",
          url: "{{row.hostedInvoiceUrl}}",
          newTab: true,
        },
      },
    ],
  },
  formContainer: { type: "page" },
}).meta(permissionMeta("invoices", "i-ph-receipt"));

/**
 * One cell of the overview grid: the block in a stack of its own, so a block
 * an extension anchors beside it (`tenantBillingPageAnchorPaths`) stacks in
 * the same column rather than adding a column to the grid. The stack carries
 * the block's own title in the roles editor.
 */
function column(key: string, block: ComponentBuilder): ComponentBuilder {
  return VStack({ alignment: "stretch", spacing: OVERVIEW_GAP })
    .child(key, block)
    .meta(block.metadata);
}

/**
 * Single billing surface for a workspace, top to bottom: what is wrong, what
 * the workspace is on, what it pays next and with what, the guarantee, who is
 * billed, and every invoice. The plan, next invoice, payment method and
 * money-back cards share a two-column grid, as the settings design lays them
 * out. Extensions anchor on the public names of `tenantBillingPage.components`
 * (the cloud module puts its in-progress invoice after `planCard` and its
 * spend protection after `billingForm`); `tenantBillingPageAnchorPaths` maps
 * those names to the positions below, which therefore must not move without
 * it.
 */
@RegisterPage()
export class SaasTenantBillingController extends PageController(
  tenantBillingPage.id,
  {
    displayName: `${KEY_PREFIX}.page.title`,
    description: `${KEY_PREFIX}.page.description`,
    category: workspaceSettingsCategory,
    icon: "i-ph-credit-card",
    // After the DMS Members (1) and Roles (3) pages, before Data export (100).
    order: 50,
    // The recovery surface of a blocked workspace: reachable under the tenant
    // access gate, unlike every other tenant page. Permission checks are
    // untouched — a member still sees only what their role allows.
    bypassTenantAccessGate: true,
  },
  // No layout of its own: like every workspace settings page it inherits the
  // settings layout (side menu, settings content width), which the overview
  // grid fits by stacking its cards in one column when the column is narrow.
) {
  static freeAccessBanner = Banner({
    fetchUrl: COMPLIMENTARY_BANNER_ENDPOINT,
  }).meta(permissionMeta("complimentary_access", "i-ph-gift"));

  static pastDueAlert = CustomComponent("DmsSaasPastDueAlert").meta(
    permissionMeta("past_due_alert", "i-ph-warning-circle"),
  );

  static overview = Grid({
    gap: OVERVIEW_GAP,
    minColumnWidth: OVERVIEW_MIN_COLUMN_WIDTH,
  })
    .child(
      "plan",
      GridRow()
        .child("current", column("planCard", planCard))
        .child("nextInvoice", nextInvoice)
        .meta(permissionMeta("plan_row", "i-ph-rows")),
    )
    .child(
      "payment",
      GridRow()
        .child("method", column("paymentMethod", paymentMethod))
        .child("guarantee", column("refundButton", refundButton))
        .meta(permissionMeta("payment_row", "i-ph-rows")),
    )
    .meta(permissionMeta("overview", "i-ph-squares-four"));

  static billingForm = CustomComponent("DmsSaasTenantBillingForm").meta(
    permissionMeta("billing_information", "i-ph-identification-card"),
  );

  // A compact table draws no caption: the section titles it, as the
  // design heads every block of the page.
  static invoices = Section({
    title: `${KEY_PREFIX}.invoices.caption`,
    card: false,
  }).child("table", invoiceTable);
}
