import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * Landing screen of every registration that authenticated before it paid: the
 * OAuth round-trip and the password login of an account belonging to no
 * workspace both hand over a tenant assignment token here. dms-auth owns the
 * hand-over and knows the route; the screen behind it is a dms-saas concern,
 * because what completes the registration is plan plus card plus provisioning.
 */
@RegisterPage()
export class SaasNoWorkspacePage extends PageController(
  "auth-no-workspace",
  {
    displayName: "$saas.no_workspace.title",
    urlSlug: "auth/no-workspace",
    publicAccess: true,
    hidden: true,
    category: pagesCategory,
  },
  EmptyLayout(),
) {
  static content = CustomComponent("DmsAuthNoWorkspace");
}
