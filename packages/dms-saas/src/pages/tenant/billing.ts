import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { TableView } from "@antelopejs/interface-dms/base";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { tenantBillingPage } from "@antelopejs/interface-dms-saas/pages";
import { tenantInvoicesDataAPI } from "../../data-api";
import { workspaceSettingsCategory } from "../module";

/**
 * Single billing surface for a workspace: the former standalone plan page is
 * the `planCard` block here. Field order is block order, and the cloud module
 * injects its own blocks after `planCard` (in-progress invoice) and after
 * `billingForm` (spend protection).
 */
@RegisterPage()
export class SaasTenantBillingController extends PageController(
  tenantBillingPage.id,
  {
    displayName: "$saas.workspace.billing.title",
    description: "$saas.workspace.billing.description",
    category: workspaceSettingsCategory,
    icon: "i-ph-credit-card",
    // The recovery surface of a blocked workspace: reachable under the tenant
    // access gate, unlike every other tenant page. Permission checks are
    // untouched — a member still sees only what their role allows.
    bypassTenantAccessGate: true,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static freeAccessBanner = CustomComponent("DmsSaasFreeAccessBanner").meta({
    name: "$saas.workspace.free_access.banner_title",
    icon: "i-ph-hourglass",
  });

  static pastDueAlert = CustomComponent("DmsSaasPastDueAlert").meta({
    name: "$saas.workspace.billing.past_due.title",
    icon: "i-ph-warning-circle",
  });

  static planCard = CustomComponent("DmsSaasTenantPlanCard").meta({
    name: "$saas.workspace.plan.current",
    icon: "i-ph-stack",
  });

  static paymentMethod = CustomComponent("DmsSaasPaymentMethodCard").meta({
    name: "$saas.workspace.billing.payment_method.title",
    icon: "i-ph-credit-card",
  });

  static billingForm = CustomComponent("DmsSaasTenantBillingForm").meta({
    name: "$saas.workspace.billing.info_title",
    icon: "i-ph-identification-card",
  });

  static refundButton = CustomComponent("DmsSaasRefundButton").meta({
    name: "$saas.workspace.billing.refund.title",
    icon: "i-ph-arrow-counter-clockwise",
  });

  static table = TableView(tenantInvoicesDataAPI, {
    caption: "$saas.workspace.billing.invoices_caption",
    // The page bypasses the tenant access gate; without this mirror the
    // table's own data routes still 403 and the invoices of a suspended
    // workspace render empty on the one page meant to settle them.
    bypassTenantAccessGate: true,
    rowActions: {
      add: false,
      copyLink: true,
      delete: false,
      details: { isEnabled: true, isVisible: true },
      edit: false,
      custom: [
        {
          label: "$saas.invoices.actions.download_pdf",
          icon: "i-ph-file-pdf",
          rule: { field: "invoicePdfUrl", notEquals: null },
          target: {
            type: "external",
            url: "{invoicePdfUrl}",
            newTab: true,
          },
        },
        {
          label: "$saas.invoices.actions.open_on_stripe",
          icon: "i-ph-arrow-square-out",
          rule: { field: "hostedInvoiceUrl", notEquals: null },
          target: {
            type: "external",
            url: "{hostedInvoiceUrl}",
            newTab: true,
          },
        },
      ],
    },
    formContainer: { type: "page" },
  });
}
