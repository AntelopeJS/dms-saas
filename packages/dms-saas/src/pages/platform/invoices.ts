import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView, type TableViewTab } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { invoicesDataAPI } from "../../data-api";
import { INVOICE_STATUSES } from "../../db";
import { statusLabelKey } from "../../utils";
import { SAAS_MODULE_ID } from "../module";
import { billingCategory } from "./categories";

const TEXT = "$saas.operator_billing.invoices";
const PERMISSIONS = "$saas.permissions.billing";
const STATS_URL = "/api/saas/billing-stats/invoices";
const STRIPE_INVOICES_URL = "/api/saas/stripe-dashboard/invoices";
const STATS_COUNT = 4;

type InvoiceTableOptions = NonNullable<
  Parameters<typeof TableView<typeof invoicesDataAPI>>[1]
>;
type InvoiceRowActions = NonNullable<
  NonNullable<InvoiceTableOptions["rowActions"]>["custom"]
>;

/**
 * The dialog issuing a credit note against the invoice of its row. Mounted by
 * every operator invoice table, with the same options.
 */
const issueCreditNoteModal = CustomComponent(
  "DmsSaasIssueCreditNoteModal",
).meta({
  name: `${PERMISSIONS}.issue_credit_note`,
  description: `${PERMISSIONS}.issue_credit_note_description`,
  icon: "i-ph-receipt-x",
});

/**
 * The actions of an invoice row: its PDF, its page in Stripe, and a credit
 * note, offered on paid and open invoices only (the server refuses the rest).
 */
export const INVOICE_ROW_ACTIONS: InvoiceRowActions = [
  {
    label: `${TEXT}.actions.download_pdf`,
    icon: "i-ph-file-pdf",
    rule: { field: "invoicePdfUrl", notEquals: null },
    target: { type: "external", url: "{invoicePdfUrl}", newTab: true },
  },
  {
    label: `${TEXT}.actions.open_in_stripe`,
    icon: "i-ph-arrow-square-out",
    target: { type: "external", url: "{stripeUrl}", newTab: true },
  },
  {
    label: `${TEXT}.actions.issue_credit_note`,
    icon: "i-ph-receipt-x",
    rule: { field: "isCreditable", equals: true },
    target: {
      type: "modal",
      size: "3xl",
      component: issueCreditNoteModal,
      title: "$saas.operator_billing.credit_modal.title",
    },
  },
];

const STATUS_TABS: TableViewTab[] = INVOICE_STATUSES.map((status) => ({
  id: status,
  label: statusLabelKey("invoice", status),
  filter: { accessorKey: "status", value: status, mode: "is" },
}));

@RegisterPage()
export class SaasInvoicesController extends PageController(
  "invoices",
  {
    displayName: `${TEXT}.title`,
    module: SAAS_MODULE_ID,
    category: billingCategory,
    icon: "i-ph-receipt",
    description: `${TEXT}.description`,
    order: 0,
  },
  DefaultLayout({
    fullWidth: true,
    headerActions: [
      {
        label: `${TEXT}.open_stripe`,
        icon: "i-ph-arrow-square-out",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "external", url: STRIPE_INVOICES_URL, newTab: true },
      },
    ],
  }),
) {
  static stats = CustomComponent("DmsSaasBillingStats")
    .options({ fetchUrl: STATS_URL, skeletonCount: STATS_COUNT })
    .meta({
      name: `${PERMISSIONS}.invoice_stats`,
      description: `${PERMISSIONS}.invoice_stats_description`,
      icon: "i-ph-chart-bar",
    });

  static table = TableView(invoicesDataAPI, {
    caption: `${TEXT}.caption`,
    searchPlaceholder: `${TEXT}.search`,
    defaultSort: { field: "issuedAt", desc: true },
    tabs: STATUS_TABS,
    footer: {
      countLabel: `${TEXT}.count`,
      hint: `${TEXT}.credit_hint`,
    },
    emptyStates: {
      firstRun: {
        title: `${TEXT}.empty.title`,
        description: `${TEXT}.empty.description`,
        icon: "i-ph-receipt",
      },
    },
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      edit: false,
      duplicate: false,
      details: { isEnabled: true, label: `${TEXT}.actions.view_details` },
      custom: INVOICE_ROW_ACTIONS,
    },
    formContainer: { type: "page" },
  });
}
