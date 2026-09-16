import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

// The default layout is the console shell: its authenticated calls answer 401
// to an anonymous visitor, which bounces them straight back to the login
// screen. Registration renders on its own, like every other public auth page.
@RegisterPage()
export class SaasRegisterController extends PageController(
  "register",
  {
    displayName: "$saas.register.title",
    description: "$saas.register.page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static registerComponent = CustomComponent("DmsSaasRegister").meta({
    name: "$saas.register.title",
    icon: "i-ph-user-plus",
  });
}
