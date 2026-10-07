import type { CustomButton } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { getReportingCurrency } from "../../../config";

const PERMISSIONS = "$saas.permissions.workspaces";

/** The metadata a block shows in the roles editor: what it is, what it lets one do. */
export interface BlockPermissionMeta {
  name: string;
  description: string;
  icon: string;
}

/**
 * The roles editor's name and description of a block of the dashboard or the
 * workspace pages, from `saas.permissions.workspaces.<key>`.
 */
export function permissionMeta(key: string, icon: string): BlockPermissionMeta {
  return {
    name: `${PERMISSIONS}.${key}`,
    description: `${PERMISSIONS}.${key}_description`,
    icon,
  };
}

interface CurrencyOptions {
  currencyCode?: string;
}

/**
 * Money cards report in the deployment's reporting currency, read per request
 * since the configuration is only known once the module is constructed.
 */
export function inReportingCurrency<T extends CurrencyOptions>(
  builder: ComponentBuilder<T>,
): ComponentBuilder<T> {
  return builder.onFilter((_permissions, options) => ({
    ...options,
    currencyCode: getReportingCurrency(),
  }));
}

/**
 * A custom form rather than the generic one: the operator chooses the access
 * model, sees what will happen, and learns when the owner's invitation e-mail
 * did not leave.
 */
const workspaceCreateModal = CustomComponent(
  "DmsSaasWorkspaceAdminCreateModal",
).meta(permissionMeta("create", "i-ph-plus"));

/** "Create workspace", in the header of the dashboard and of the workspace list. */
export const CREATE_WORKSPACE_BUTTON: CustomButton = {
  id: "create-workspace",
  label: "$saas.workspaces.operator_create.button",
  icon: "i-ph-plus",
  color: "primary",
  target: {
    type: "modal",
    size: "lg",
    component: workspaceCreateModal,
    title: "$saas.workspaces.operator_create.title",
    description: "$saas.workspaces.operator_create.description",
  },
};
