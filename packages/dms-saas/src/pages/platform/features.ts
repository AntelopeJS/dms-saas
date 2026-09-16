import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { featuresDataAPI } from "../../data-api";
import { SAAS_MODULE_ID } from "../module";
import { catalogCategory } from "./categories";

@RegisterPage()
export class SaasFeaturesController extends PageController(
  "features",
  {
    displayName: "$saas.features.title",
    module: SAAS_MODULE_ID,
    category: catalogCategory,
    icon: "i-ph-toggle-right",
    description: "$saas.features.description",
    order: 10,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(featuresDataAPI, {
    caption: "$saas.features.caption",
    rowActions: {
      add: true,
      copyLink: true,
      delete: { isEnabled: true, isVisible: true },
      details: { isEnabled: true, isVisible: true },
      duplicate: true,
      edit: { isEnabled: true, isVisible: true },
      hasSelection: true,
    },
    formContainer: { type: "page" },
  });
}
