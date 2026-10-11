import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { EmptyLayout } from "@antelopejs/interface-dms/base/layouts";

// authOnly keeps this page reachable when the subscription access gate
// blocks the workspace: it needs authentication but no permission, so a
// blocked member can still land here and regularize (or contact the owner).
@RegisterPage()
export class SaasWorkspaceSuspendedController extends PageController(
  "workspace-suspended",
  {
    displayName: "$saas.public.suspended.page_title",
    description: "$saas.public.suspended.page_description",
    category: pagesCategory,
    authOnly: true,
    hidden: true,
  },
  EmptyLayout(),
) {
  static content = CustomComponent("DmsSaasWorkspaceSuspended").meta({
    name: "$saas.permissions.public.workspace_suspended",
    description: "$saas.permissions.public.workspace_suspended_description",
    icon: "i-ph-lock-simple",
  });
}
