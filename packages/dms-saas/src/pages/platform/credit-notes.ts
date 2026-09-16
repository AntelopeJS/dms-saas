import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { creditNotesDataAPI } from "../../data-api";
import { SAAS_MODULE_ID } from "../module";
import { billingCategory } from "./categories";

@RegisterPage()
export class SaasCreditNotesController extends PageController(
  "credit-notes",
  {
    displayName: "$saas.credit_notes.title",
    module: SAAS_MODULE_ID,
    category: billingCategory,
    icon: "i-ph-receipt-x",
    description: "$saas.credit_notes.description",
    order: 10,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(creditNotesDataAPI, {
    caption: "$saas.credit_notes.caption",
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      details: { isEnabled: true, isVisible: true },
      edit: false,
    },
    formContainer: { type: "page" },
  });
}
