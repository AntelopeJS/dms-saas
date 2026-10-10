import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  Banner,
  Card,
  KeyValueList,
  TableView,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { tenantBillingPage } from "@antelopejs/interface-dms-saas/pages";
import { tenantInvoicesDataAPI } from "../../data-api";
import { workspaceSettingsCategory } from "../module";

const KEY_PREFIX = "$saas.tenant_billing";
const PERMISSION_PREFIX = "$saas.permissions.billing_page";
const NEXT_INVOICE_ENDPOINT = "/api/saas/tenant/upcoming-invoice";
const COMPLIMENTARY_BANNER_ENDPOINT = "/api/saas/tenant/complimentary-banner";
const NEXT_INVOICE_SKELETON_ROWS = 6;

/** Name, description and icon of a block as the roles editor lists it. */
function permissionMeta(key: string, icon: string) {
  return {
    name: `${PERMISSION_PREFIX}.${key}`,
    description: `${PERMISSION_PREFIX}.${key}_description`,
    icon,
  };
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

/**
 * Single billing surface for a workspace, top to bottom: what is wrong, what
 * the workspace is on, what it pays next and with what, the guarantee, who is
 * billed, and every invoice. Field order is block order, and the cloud module
 * injects its own blocks after `planCard` (in-progress invoice) and after
 * `billingForm` (spend protection), so those keys stay top-level.
 */
@RegisterPage()
export class SaasTenantBillingController extends PageController(
  tenantBillingPage.id,
  {
    displayName: `${KEY_PREFIX}.page.title`,
    description: `${KEY_PREFIX}.page.description`,
    category: workspaceSettingsCategory,
    icon: "i-ph-credit-card",
    // The recovery surface of a blocked workspace: reachable under the tenant
    // access gate, unlike every other tenant page. Permission checks are
    // untouched — a member still sees only what their role allows.
    bypassTenantAccessGate: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static freeAccessBanner = Banner({
    fetchUrl: COMPLIMENTARY_BANNER_ENDPOINT,
  }).meta(permissionMeta("complimentary_access", "i-ph-gift"));

  static pastDueAlert = CustomComponent("DmsSaasPastDueAlert").meta(
    permissionMeta("past_due_alert", "i-ph-warning-circle"),
  );

  static planCard = CustomComponent("DmsSaasTenantPlanCard").meta(
    permissionMeta("plan", "i-ph-stack"),
  );

  static nextInvoice = Card({
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

  static paymentMethod = CustomComponent("DmsSaasPaymentMethodCard").meta(
    permissionMeta("payment_method", "i-ph-credit-card"),
  );

  static refundButton = CustomComponent("DmsSaasRefundButton").meta(
    permissionMeta("money_back", "i-ph-arrow-counter-clockwise"),
  );

  static billingForm = CustomComponent("DmsSaasTenantBillingForm").meta(
    permissionMeta("billing_information", "i-ph-identification-card"),
  );

  static table = TableView(tenantInvoicesDataAPI, {
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
            url: "{invoicePdfUrl}",
            newTab: true,
          },
        },
        {
          label: "$saas.invoices.actions.open_on_stripe",
          icon: "i-ph-arrow-square-out",
          rule: { field: "hostedInvoiceUrl", notEquals: null },
          target: {
            type: "external",
            url: "{hostedInvoiceUrl}",
            newTab: true,
          },
        },
      ],
    },
    formContainer: { type: "page" },
  }).meta(permissionMeta("invoices", "i-ph-receipt"));
}
