import { InterfaceFunction } from "@antelopejs/interface-core";
import type {
  Component,
  PlacementSide,
} from "@antelopejs/interface-dms/component";
import {
  type CategoryInfo,
  type PageExtensionComponent,
  type PageExtensionInfo,
  internal as pageInternal,
} from "@antelopejs/interface-dms/page";
import {
  MODULES_ROOT_DEFINITION,
  SAAS_MODULE_DEFINITION,
  SETTINGS_ROOT_DEFINITION,
  WORKSPACE_SETTINGS_CATEGORY_DEFINITION,
} from "./page-definitions";

/**
 * Workspace settings descriptor for synchronous page declarations.
 * Use {@link GetWorkspaceSettingsCategory} when canonical runtime identity is
 * required.
 */
export const workspaceSettingsCategory: CategoryInfo = {
  ...WORKSPACE_SETTINGS_CATEGORY_DEFINITION,
  category: SETTINGS_ROOT_DEFINITION,
  urlTransparent: false,
  hidden: undefined,
  bypassTenantAccessGate: undefined,
};

/** Resolve the workspace settings category registered by the SaaS runtime. */
export const GetWorkspaceSettingsCategory =
  InterfaceFunction<() => CategoryInfo>();

/** Stable identifiers for the tenant billing page and its extension anchors. */
export const tenantBillingPage = {
  id: "billing",
  fullId: "settings.workspace.billing",
  fullSlug: "/settings/workspace/billing",
  components: {
    freeAccessBanner: "freeAccessBanner",
    pastDueAlert: "pastDueAlert",
    planCard: "planCard",
    paymentMethod: "paymentMethod",
    billingForm: "billingForm",
    refundButton: "refundButton",
    table: "table",
  },
} as const;

/** Component key owned by the tenant billing page. */
export type TenantBillingPageComponentKey =
  (typeof tenantBillingPage.components)[keyof typeof tenantBillingPage.components];

/** Fields shared by anchored and appended tenant billing page extensions. */
export interface TenantBillingPageExtensionComponentBase {
  key: string;
  component: Component;
  order?: number;
}

/** Component placed before or after a billing page-owned anchor. */
export interface TenantBillingPageAnchoredExtensionComponent extends TenantBillingPageExtensionComponentBase {
  side: Extract<PlacementSide, "before" | "after">;
  anchorKey: TenantBillingPageComponentKey;
}

/** Component appended after all billing page-owned components. */
export interface TenantBillingPageAppendedExtensionComponent extends TenantBillingPageExtensionComponentBase {
  side?: Extract<PlacementSide, "end">;
  anchorKey?: never;
}

/** Component contributed by a tenant billing page extension. */
export type TenantBillingPageExtensionComponent =
  | TenantBillingPageAnchoredExtensionComponent
  | TenantBillingPageAppendedExtensionComponent;

/** Identifier and components contributed by one external module. */
export interface TenantBillingPageExtension {
  name: string;
  components: readonly TenantBillingPageExtensionComponent[];
}

/** Handle used to remove a registered tenant billing page extension. */
export interface TenantBillingPageExtensionRegistration {
  unregister(): void;
}

/**
 * SaaS module descriptor for synchronous page declarations.
 * Use {@link GetPlatformSaasModule} when canonical runtime identity is
 * required.
 */
export const platformSaasModule: CategoryInfo = {
  id: SAAS_MODULE_DEFINITION.registration.id,
  fullId: SAAS_MODULE_DEFINITION.fullId,
  fullSlug: SAAS_MODULE_DEFINITION.fullSlug,
  category: MODULES_ROOT_DEFINITION,
  displayName: SAAS_MODULE_DEFINITION.registration.title,
  description: SAAS_MODULE_DEFINITION.registration.description,
  icon: SAAS_MODULE_DEFINITION.registration.icon,
  urlSlug: SAAS_MODULE_DEFINITION.registration.id,
  type: "label",
  isModuleRoot: true,
  urlTransparent: false,
  hidden: undefined,
  bypassTenantAccessGate: undefined,
};

/** Resolve the SaaS module root registered by the SaaS runtime. */
export const GetPlatformSaasModule = InterfaceFunction<() => CategoryInfo>();

/** Stable identifiers for the platform-owner workspace detail page. */
export const platformWorkspaceDetailPage = {
  fullId: "modules.saas.customers.workspaces.detail",
  components: {
    header: "header",
    summary: "summary",
    body: "body",
  },
} as const;

/** External blocks contributed to the platform workspace detail page. */
export interface PlatformWorkspaceDetailPageExtension {
  name: string;
  components: readonly PageExtensionComponent[];
}

/** Handle used to remove a platform workspace detail extension. */
export interface PlatformWorkspaceDetailPageExtensionRegistration {
  unregister(): void;
}

function toPageExtensionComponent(
  input: TenantBillingPageExtensionComponent,
): PageExtensionComponent {
  const component: PageExtensionComponent = {
    key: input.key,
    component: input.component,
    side: input.side ?? "end",
    order: input.order ?? 0,
  };
  // `anchorPath` is what the DMS reads -- extension-assembly takes its first
  // segment as the anchor key. The conditional spread this replaces set
  // `anchorKey`, a property PageExtensionComponent does not declare, so every
  // anchored extension was silently appended at the end of the page instead.
  if (input.anchorKey) component.anchorPath = [input.anchorKey];
  return component;
}

/**
 * Register components on the tenant billing page without importing its
 * controller class. Registration may happen before the page itself loads.
 */
export function RegisterTenantBillingPageExtension(
  extension: TenantBillingPageExtension,
): TenantBillingPageExtensionRegistration {
  const info: PageExtensionInfo = {
    extensionName: extension.name,
    targetFullId: tenantBillingPage.fullId,
    components: extension.components.map(toPageExtensionComponent),
  };
  pageInternal.RegisterPageExtension.register(info);
  return {
    unregister: () => pageInternal.RegisterPageExtension.unregister(info),
  };
}

/** Register module-owned blocks on the platform workspace detail page. */
export function RegisterPlatformWorkspaceDetailPageExtension(
  extension: PlatformWorkspaceDetailPageExtension,
): PlatformWorkspaceDetailPageExtensionRegistration {
  const info: PageExtensionInfo = {
    extensionName: extension.name,
    targetFullId: platformWorkspaceDetailPage.fullId,
    components: [...extension.components],
  };
  pageInternal.RegisterPageExtension.register(info);
  return {
    unregister: () => pageInternal.RegisterPageExtension.unregister(info),
  };
}
