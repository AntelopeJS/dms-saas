// The TypeScript source the contract check compiles against the packed
// tarball. It lives apart from the script that runs it because it is a
// document, not logic: every symbol here is one the package promises to
// export, and the file is meant to be read as that list.

/**
 * The consumer module the contract check compiles against the packed tarball.
 * Held as data rather than a template literal so it reads as what it is: the
 * list of symbols the package promises to export. `__PACKAGE_NAME__` and the
 * `__SPEC_*__` markers are filled in by `consumerSource` below.
 */
const CONSUMER_TEMPLATE = `
import type { Component } from "@antelopejs/interface-dms/component";
import { PageController } from "@antelopejs/interface-dms/page";
import { construct, start, stop } from "__PACKAGE_NAME__";
import type {
  ComplimentarySubscriptionState,
  TenantCustomerBalance,
  TenantCustomerBalanceScope,
} from "__SPEC_BILLING__";
import { GetTenantCustomerBalance, isComplimentarySubscription } from "__SPEC_BILLING__";
import { HiddenStringFilter } from "__SPEC_DATAAPI__";
import type {
  Invoice,
  PaidUsagePeriod,
  Plan,
} from "__SPEC_DB__";
import {
  FeatureModel,
  InvoiceModel,
  PlanModel,
  TenantSubscriptionModel,
} from "__SPEC_DB__";
import type {
  InvoiceLineItem,
  InvoiceLineItemSelection,
  InvoiceLineItemsContext,
  InvoiceLineItemsProvider,
  InvoiceLineItemsResolver,
  PreparedInvoiceLineItem,
  SkippedInvoiceLineItem,
  SkippedLineItemReason,
} from "__SPEC_INVOICELINEITEMS__";
import {
  buildInvoiceLineKey,
  internal,
  LINE_KEY_SEPARATOR,
  RegisterInvoiceLineItemsProvider,
  selectInvoiceLineItemsToCreate,
  UnregisterInvoiceLineItemsProvider,
} from "__SPEC_INVOICELINEITEMS__";
import type {
  PlatformWorkspaceDetailPageExtensionRegistration,
  TenantBillingPageExtensionRegistration,
} from "__SPEC_PAGES__";
import {
  GetPlatformSaasModule,
  GetWorkspaceSettingsCategory,
  platformSaasModule,
  platformWorkspaceDetailPage,
  RegisterPlatformWorkspaceDetailPageExtension,
  RegisterTenantBillingPageExtension,
  tenantBillingPage,
  workspaceSettingsCategory,
} from "__SPEC_PAGES__";
import type {
  TenantPlanCatalog,
  TenantPlanView,
} from "__SPEC_PLANS__";
import {
  buildTenantPlanCatalog,
  monthlyPrice,
} from "__SPEC_PLANS__";
import type {
  TenantBeingProvisionedPayload,
} from "__SPEC_PROVISIONING__";
import type {
  RegistrationExtrasLimits,
} from "__SPEC_REGISTRATION__";
import {
  REGISTRATION_EXTRAS_LIMITS,
} from "__SPEC_REGISTRATION__";
import type {
  WorkspaceLifecycleConsumer,
  WorkspaceLifecycleMessage,
  WorkspaceLifecycleReceipt,
} from "__SPEC_WORKSPACELIFECYCLE__";
import {
  IsWorkspaceProvisioningCommitted,
  RegisterWorkspaceLifecycleConsumer,
  UnregisterWorkspaceLifecycleConsumer,
  WORKSPACE_LIFECYCLE_TRANSITIONS,
} from "__SPEC_WORKSPACELIFECYCLE__";
import {
  GetTenantCustomerBalance as rootGetTenantCustomerBalance,
  invoiceLineItems as rootInvoiceLineItems,
  workspaceLifecycle as rootWorkspaceLifecycle,
} from "__SPEC_ROOT__";

declare const pageComponent: Component;
declare const customerBalanceScope: TenantCustomerBalanceScope;

export const customerBalance: Promise<TenantCustomerBalance> =
  GetTenantCustomerBalance(customerBalanceScope);

export class CloudWorkspaceSettingsController extends PageController("cloud", {
  displayName: "Cloud",
  category: workspaceSettingsCategory,
}) {}

export class CloudPlatformController extends PageController("cloud", {
  displayName: "Cloud",
  category: platformSaasModule,
  module: "saas",
}) {}

export const billingExtensionRegistration: TenantBillingPageExtensionRegistration =
  RegisterTenantBillingPageExtension({
    name: "CloudBillingBlocks",
    components: [
      {
        key: "inProgressInvoice",
        component: pageComponent,
        side: "after",
        anchorKey: tenantBillingPage.components.planCard,
      },
    ],
  });

export const workspaceLifecycleRegistration =
  RegisterWorkspaceLifecycleConsumer({
    name: "cloud.workspaces",
    transitions: ["created", "suspended", "reactivation_requested"],
    async consume(message) {
      return { receiptId: message.operationId };
    },
  });

export const provisioningCommitted: Promise<boolean> =
  IsWorkspaceProvisioningCommitted("tenant-id");

// The root entry flattens what it can and namespaces the two surfaces that
// both export \`internal\`. Reaching through the namespaces here is what keeps
// the barrel from silently losing them.
export const rootSurface = [
  rootGetTenantCustomerBalance,
  rootInvoiceLineItems.RegisterInvoiceLineItemsProvider,
  rootInvoiceLineItems.internal,
  rootWorkspaceLifecycle.RegisterWorkspaceLifecycleConsumer,
  rootWorkspaceLifecycle.internal,
];

export type ConsumerTypes = [
  ComplimentarySubscriptionState,
  PaidUsagePeriod,
  TenantCustomerBalance,
  TenantCustomerBalanceScope,
  Invoice,
  Plan,
  RegistrationExtrasLimits,
  TenantBeingProvisionedPayload,
  TenantPlanCatalog,
  TenantPlanView,
  InvoiceLineItem,
  InvoiceLineItemSelection,
  InvoiceLineItemsContext,
  InvoiceLineItemsProvider,
  InvoiceLineItemsResolver,
  PreparedInvoiceLineItem,
  SkippedInvoiceLineItem,
  SkippedLineItemReason,
  PlatformWorkspaceDetailPageExtensionRegistration,
  WorkspaceLifecycleConsumer,
  WorkspaceLifecycleMessage,
  WorkspaceLifecycleReceipt,
];
export const consumerValues = [
  isComplimentarySubscription,
  construct,
  start,
  stop,
  GetTenantCustomerBalance,
  HiddenStringFilter,
  buildTenantPlanCatalog,
  FeatureModel,
  InvoiceModel,
  monthlyPrice,
  PlanModel,
  REGISTRATION_EXTRAS_LIMITS,
  TenantSubscriptionModel,
  buildInvoiceLineKey,
  internal,
  LINE_KEY_SEPARATOR,
  RegisterInvoiceLineItemsProvider,
  selectInvoiceLineItemsToCreate,
  UnregisterInvoiceLineItemsProvider,
  billingExtensionRegistration,
  workspaceLifecycleRegistration,
  GetPlatformSaasModule,
  GetWorkspaceSettingsCategory,
  platformSaasModule,
  platformWorkspaceDetailPage,
  RegisterPlatformWorkspaceDetailPageExtension,
  tenantBillingPage,
  workspaceSettingsCategory,
  RegisterWorkspaceLifecycleConsumer,
  UnregisterWorkspaceLifecycleConsumer,
  WORKSPACE_LIFECYCLE_TRANSITIONS,
];
`;

/**
 * @param {{ name: string }} manifest the packed package's manifest
 * @param {Record<string, string>} INTERFACE_SPECIFIERS the interface import specifiers
 * @returns {string} the consumer source to typecheck against the tarball
 */
export function consumerSource(manifest, INTERFACE_SPECIFIERS) {
  let source = CONSUMER_TEMPLATE.replaceAll("__PACKAGE_NAME__", manifest.name);
  for (const [key, specifier] of Object.entries(INTERFACE_SPECIFIERS)) {
    source = source.replaceAll(`__SPEC_${key.toUpperCase()}__`, specifier);
  }
  return source;
}
