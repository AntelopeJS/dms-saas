import type {
  MenuOptions,
  ModuleInfo,
  PageInfo,
} from "@antelopejs/interface-dms/page";

interface SaasModuleDefinition {
  fullId: string;
  fullSlug: string;
  registration: ModuleInfo;
}

interface WorkspaceSettingsCategoryDefinition extends Omit<
  MenuOptions,
  "category" | "module"
> {
  id: string;
  fullId: string;
  fullSlug: string;
}

export const MODULES_ROOT_DEFINITION: PageInfo = {
  id: "modules",
  fullId: "modules",
  fullSlug: "/modules",
  layoutUrl: "/modules/pagelayout",
  category: undefined,
  displayName: "$modules.title",
  description: "$modules.intro",
  urlSlug: "/modules",
  icon: "i-ph-squares-four",
  order: 2,
  noComponentPermissions: true,
  isModuleRoot: true,
  hidden: undefined,
  publicAccess: undefined,
  authOnly: undefined,
  bypassTenantAccessGate: undefined,
};

export const SETTINGS_ROOT_DEFINITION: PageInfo = {
  id: "settings",
  fullId: "settings",
  fullSlug: "/settings",
  layoutUrl: "/settings/pagelayout",
  category: undefined,
  displayName: "$page.settings.title",
  description: "$page.settings.intro",
  urlSlug: "/settings",
  icon: "i-ph-gear",
  order: 3,
  noComponentPermissions: true,
  hidden: undefined,
  publicAccess: undefined,
  authOnly: undefined,
  bypassTenantAccessGate: undefined,
};

export const SAAS_MODULE_ID = "saas";

export const SAAS_MODULE_DEFINITION: SaasModuleDefinition = {
  fullId: `${MODULES_ROOT_DEFINITION.fullId}.${SAAS_MODULE_ID}`,
  fullSlug: `${MODULES_ROOT_DEFINITION.fullSlug}/${SAAS_MODULE_ID}`,
  registration: {
    id: SAAS_MODULE_ID,
    title: "$saas.module.title",
    description: "$saas.module.description",
    icon: "i-ph-buildings",
    landingPage: "dashboard",
  },
};

export const WORKSPACE_SETTINGS_CATEGORY_DEFINITION: WorkspaceSettingsCategoryDefinition =
  {
    id: "workspace",
    fullId: `${SETTINGS_ROOT_DEFINITION.fullId}.workspace`,
    fullSlug: `${SETTINGS_ROOT_DEFINITION.fullSlug}/workspace`,
    displayName: "$saas.workspace.settings.title",
    urlSlug: "workspace",
    icon: "i-ph-buildings",
    order: 2,
  };
