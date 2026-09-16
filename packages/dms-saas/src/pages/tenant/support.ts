import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { workspaceSettingsCategory } from "../module";

@RegisterPage()
export class SaasTenantSupportPageController extends PageController(
  "support",
  {
    displayName: "$saas.support.tenant.title",
    description: "$saas.support.tenant.description",
    category: workspaceSettingsCategory,
    icon: "i-ph-lifebuoy",
    order: 90,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsSaasTenantSupport");
}
