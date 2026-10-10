import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

// Read by anonymous visitors before they have an account, like the sign-up
// screen it leads to: the console layout would bounce them to the login.
@RegisterPage()
export class SaasPricingPage extends PageController(
  "pricing",
  {
    displayName: "$saas.public.pricing.page_title",
    description: "$saas.public.pricing.page_description",
    category: pagesCategory,
    publicAccess: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static pricing = CustomComponent("DmsSaasPricing").meta({
    name: "$saas.permissions.public.pricing",
    description: "$saas.permissions.public.pricing_description",
    icon: "i-ph-tag",
  });
}
