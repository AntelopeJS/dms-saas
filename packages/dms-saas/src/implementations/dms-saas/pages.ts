import type { CategoryInfo } from "@antelopejs/interface-dms/page";
import { saasModule, workspaceSettingsCategory } from "../../pages/module";

export function GetPlatformSaasModule(): CategoryInfo {
  return saasModule;
}

export function GetWorkspaceSettingsCategory(): CategoryInfo {
  return workspaceSettingsCategory;
}
