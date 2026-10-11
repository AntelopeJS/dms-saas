import {
  Controller,
  HTTPResult,
  Parameter,
  Post,
} from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { AuthTenantOwner } from "@antelopejs/interface-dms/guards";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import type { User } from "@antelopejs/interface-dms/auth/db";
import Stripe from "stripe";
import {
  type Invoice,
  InvoiceModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../../db";
import { getStripeClient } from "../../stripe/client";
import { isComplimentarySubscription } from "../../workspaces/complimentary";

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;
const PAYABLE_STATUS = "open";
const INVOICE_DOCUMENT_TYPE = "invoice";
const LOG_PREFIX = "[dms-saas:pay-invoice]";

/** What paying an invoice with the default card ended in. */
export interface PayInvoiceResult {
  /** Stripe's status of the invoice after the attempt (`paid` on success). */
  status: string | null;
}

/** Only an invoice still waiting for its money can be paid again. */
export function isPayableInvoice(invoice: Invoice | undefined): boolean {
  return (
    !!invoice &&
    invoice.documentType === INVOICE_DOCUMENT_TYPE &&
    invoice.status === PAYABLE_STATUS
  );
}

function assertPayableSubscription(
  subscription: TenantSubscription | undefined,
): void {
  assert(
    subscription?.stripeCustomerId &&
      !isComplimentarySubscription(subscription),
    HTTP_BAD_REQUEST,
    "saas.errors.workspace.no_stripe_customer",
  );
}

/**
 * A declined card is the owner's to fix (another card); a refusal of the
 * request itself means the invoice changed meanwhile; anything else is
 * Stripe being unreachable, worth a retry.
 */
export function toPaymentFailure(error: unknown): HTTPResult {
  if (error instanceof Stripe.errors.StripeCardError) {
    return new HTTPResult(
      HTTP_PAYMENT_REQUIRED,
      "saas.errors.billing.payment_declined",
    );
  }
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return new HTTPResult(HTTP_CONFLICT, "saas.errors.invoice.not_payable");
  }
  return new HTTPResult(
    HTTP_SERVICE_UNAVAILABLE,
    "saas.errors.billing.payment_unavailable",
  );
}

// Part of the recovery path of a blocked workspace, like the portal: paying
// the unpaid invoice is what lifts the block.
export class SaasBillingPayInvoiceController extends Controller(
  "/api/saas/billing",
) {
  /**
   * Charges the customer's default card for one open invoice. The mirror and
   * the workspace status follow from Stripe's `invoice.paid` webhook, as for
   * any other payment.
   */
  @Post("/invoices/:invoiceId/pay")
  async payInvoice(
    @AuthTenantOwner({ bypassTenantAccessGate: true }) _user: User,
    @Parameter("invoiceId") invoiceId: string,
    @TenantScopedModel(InvoiceModel) invoiceModel: InvoiceModel,
    @TenantScopedModel(TenantSubscriptionModel)
    tenantSubscriptionModel: TenantSubscriptionModel,
  ): Promise<PayInvoiceResult> {
    assertPayableSubscription(await tenantSubscriptionModel.findOne());
    const invoice = await invoiceModel.get(invoiceId);
    assert(
      invoice && isPayableInvoice(invoice),
      HTTP_CONFLICT,
      "saas.errors.invoice.not_payable",
    );
    try {
      const paid = await getStripeClient().invoices.pay(
        invoice.stripeInvoiceId,
      );
      return { status: paid.status ?? null };
    } catch (error) {
      Logging.Warn(
        `${LOG_PREFIX} payment of ${invoice.stripeInvoiceId} failed`,
        error,
      );
      throw toPaymentFailure(error);
    }
  }
}
