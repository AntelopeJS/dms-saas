import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  StatGroup,
  TableView,
  type TableViewTab,
} from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { creditNotesDataAPI } from "../../data-api";
import { statusLabelKey } from "../../utils";
import { SAAS_MODULE_ID } from "../module";
import { billingCategory } from "./categories";

const TEXT = "$saas.operator_billing.credit_notes";
const PERMISSIONS = "$saas.permissions.billing";
const STATS_URL = "/api/saas/billing-stats/credit-notes";
const INVOICES_PAGE_URL = "/modules/saas/billing/invoices";
const STATS_COUNT = 3;

const TYPE_TABS: TableViewTab[] = (
  ["credit_to_balance", "refund"] as const
).map((type) => ({
  id: type,
  label: statusLabelKey("credit_note_type", type),
  filter: { accessorKey: "type", value: type, mode: "is" },
}));

const VOID_TAB: TableViewTab = {
  id: "void",
  label: statusLabelKey("credit_note", "void"),
  filter: { accessorKey: "status", value: "void", mode: "is" },
};

@RegisterPage()
export class SaasCreditNotesController extends PageController(
  "credit-notes",
  {
    displayName: `${TEXT}.title`,
    module: SAAS_MODULE_ID,
    category: billingCategory,
    icon: "i-ph-receipt-x",
    description: `${TEXT}.description`,
    order: 10,
  },
  DefaultLayout({
    fullWidth: true,
    headerActions: [
      {
        label: `${TEXT}.to_invoices`,
        icon: "i-ph-receipt",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: INVOICES_PAGE_URL },
      },
    ],
  }),
) {
  static stats = StatGroup({
    fetchUrl: STATS_URL,
    skeletonCount: STATS_COUNT,
    label: "$saas.operator_billing.stats.label",
  }).meta({
    name: `${PERMISSIONS}.credit_note_stats`,
    description: `${PERMISSIONS}.credit_note_stats_description`,
    icon: "i-ph-chart-bar",
  });

  static table = TableView(creditNotesDataAPI, {
    caption: `${TEXT}.caption`,
    searchPlaceholder: `${TEXT}.search`,
    defaultSort: { field: "issuedAt", desc: true },
    tabs: [...TYPE_TABS, VOID_TAB],
    footer: { countLabel: `${TEXT}.count`, hint: `${TEXT}.legend` },
    emptyStates: {
      firstRun: {
        title: `${TEXT}.empty.title`,
        description: `${TEXT}.empty.description`,
        icon: "i-ph-receipt-x",
        actions: [{ label: `${TEXT}.to_invoices`, to: INVOICES_PAGE_URL }],
      },
    },
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      edit: false,
      duplicate: false,
      details: { isEnabled: true, label: `${TEXT}.actions.view_details` },
      custom: [
        {
          label: `${TEXT}.actions.download_pdf`,
          icon: "i-ph-file-pdf",
          rule: { field: "pdfUrl", notEquals: null },
          target: { type: "external", url: "{pdfUrl}", newTab: true },
        },
      ],
    },
    formContainer: { type: "page" },
  });
}
