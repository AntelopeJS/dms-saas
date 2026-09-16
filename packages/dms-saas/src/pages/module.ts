import {
  Category,
  type CategoryInfo,
  RegisterModule,
  settingsCategory,
} from "@antelopejs/interface-dms/page";
import {
  SAAS_MODULE_DEFINITION,
  SAAS_MODULE_ID,
  WORKSPACE_SETTINGS_CATEGORY_DEFINITION,
} from "./definitions";

export { SAAS_MODULE_ID };

export const saasModule = RegisterModule(SAAS_MODULE_DEFINITION.registration);

export const workspaceSettingsCategory: CategoryInfo = Category(
  WORKSPACE_SETTINGS_CATEGORY_DEFINITION.id,
  {
    category: settingsCategory,
    displayName: WORKSPACE_SETTINGS_CATEGORY_DEFINITION.displayName,
    urlSlug: WORKSPACE_SETTINGS_CATEGORY_DEFINITION.urlSlug,
    icon: WORKSPACE_SETTINGS_CATEGORY_DEFINITION.icon,
    order: WORKSPACE_SETTINGS_CATEGORY_DEFINITION.order,
  },
);
