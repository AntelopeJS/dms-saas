import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { planMigrationsDataAPI } from "../../../data-api";
import { SaasPlansController } from "./index";

@RegisterPage()
export class SaasPlanMigrationsController extends PageController(
  "migrations",
  {
    displayName: "$saas.plans.migrations.title",
    category: SaasPlansController,
    icon: "i-ph-arrows-clockwise",
    description: "$saas.plans.migrations.description",
    hidden: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static table = TableView(planMigrationsDataAPI, {
    caption: "$saas.plans.migrations.caption",
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
