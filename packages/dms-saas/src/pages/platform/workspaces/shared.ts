import type {
  CustomButton,
  TableViewFooterSummarySerialized,
  TableViewOptionsSerialized,
} from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import type { ComponentBuilder } from "@antelopejs/interface-dms/component";
import { getReportingCurrency } from "../../../config";
import { type BlockPermissionMeta, blockMeta } from "../../block-meta";

const PERMISSIONS = "$saas.permissions.workspaces";

/**
 * The roles editor's name and description of a block of the dashboard or the
 * workspace pages, from `saas.permissions.workspaces.<key>`.
 */
export function permissionMeta(key: string, icon: string): BlockPermissionMeta {
  return blockMeta(PERMISSIONS, key, icon);
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

function inReportingCurrencyFormat(
  summary: TableViewFooterSummarySerialized,
): TableViewFooterSummarySerialized {
  if (summary.format?.style !== "currency") return summary;
  return {
    ...summary,
    format: { ...summary.format, currency: getReportingCurrency() },
  };
}

/**
 * A table whose footer totals money, in the reporting currency: the currency
 * summaries take its code per request, like the money cards.
 */
export function withReportingCurrencyTotals(
  builder: ComponentBuilder<TableViewOptionsSerialized>,
): ComponentBuilder<TableViewOptionsSerialized> {
  return builder.onFilter((_permissions, options) =>
    options.footer?.summary
      ? {
          ...options,
          footer: {
            ...options.footer,
            summary: options.footer.summary.map(inReportingCurrencyFormat),
          },
        }
      : options,
  );
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
