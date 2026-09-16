import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { workspaceSettingsCategory } from "../module";

@RegisterPage()
export class SaasTenantGeneralController extends PageController("general", {
  displayName: "$saas.workspace.general.title",
  description: "$saas.workspace.general.description",
  category: workspaceSettingsCategory,
  icon: "i-ph-sliders-horizontal",
  order: 0,
}) {
  static identity = CustomComponent("DmsSaasWorkspaceIdentity").meta({
    name: "$saas.workspace.general.identity_title",
    icon: "i-ph-buildings",
  });

  // Separate component, hence a separate permission node: granting the rename
  // form must not imply the right to delete the workspace.
  static dangerZone = CustomComponent("DmsSaasWorkspaceDangerZone").meta({
    name: "$saas.workspace.general.danger_zone_title",
    icon: "i-ph-warning-octagon",
  });
}
