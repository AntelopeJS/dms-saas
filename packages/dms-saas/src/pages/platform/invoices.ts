import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { invoicesDataAPI } from "../../data-api";
import { SAAS_MODULE_ID } from "../module";
import { billingCategory } from "./categories";

const issueCreditNoteModal = CustomComponent("DmsSaasIssueCreditNoteModal");

@RegisterPage()
export class SaasInvoicesController extends PageController(
  "invoices",
  {
    displayName: "$saas.invoices.title",
    module: SAAS_MODULE_ID,
    category: billingCategory,
    icon: "i-ph-receipt",
    description: "$saas.invoices.description",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(invoicesDataAPI, {
    caption: "$saas.invoices.caption",
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      details: { isEnabled: true, isVisible: true },
      edit: false,
      custom: [
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
        {
          label: "$saas.invoices.actions.issue_credit_note",
          icon: "i-ph-receipt-x",
          target: {
            type: "modal",
            component: issueCreditNoteModal,
            title: "$saas.credit_notes.modal.title",
          },
        },
      ],
    },
    formContainer: { type: "page" },
  });
}
