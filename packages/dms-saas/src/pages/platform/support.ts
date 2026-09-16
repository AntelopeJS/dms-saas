import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { SAAS_MODULE_ID } from "../module";
import { supportCategory } from "./categories";

@RegisterPage()
export class SaasPlatformSupportPageController extends PageController(
  "support",
  {
    displayName: "$saas.support.platform.title",
    description: "$saas.support.platform.description",
    module: SAAS_MODULE_ID,
    category: supportCategory,
    icon: "i-ph-lifebuoy",
    order: 0,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsSaasPlatformSupport");
}
