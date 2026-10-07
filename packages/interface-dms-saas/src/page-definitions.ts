import type { ModuleInfo, PageInfo } from "@antelopejs/interface-dms/page";

interface SaasModuleDefinition {
  fullId: string;
  fullSlug: string;
  registration: ModuleInfo;
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
