const BILLING_STATUS_ENDPOINT = "/api/saas/billing/status";
const BILLING_STATUS_STATE_KEY = "saas-billing-status";

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface UnpaidInvoiceRef {
  number: string | null;
  amount: number;
  currency: string;
  hostedInvoiceUrl: string | null;
}

export interface UnpaidInvoiceSummary extends UnpaidInvoiceRef {
  failedAt: string | null;
  nextRetryAt: string | null;
  suspendAt: string | null;
}

export interface BillingStatusResponse {
  hasStripeCustomer: boolean;
  status: string | null;
  isTenantOwner: boolean;
  paymentMethod: PaymentMethodSummary | null;
  unpaidInvoice: UnpaidInvoiceSummary | null;
}

/** Read by the past-due alert, the payment method card and the portal button;
 * each call reaches Stripe, so the three of them share one request. */
export function useBillingStatus(): SharedRequest<BillingStatusResponse> {
  const { $authFetch } = useAuthFetch();
  return useSharedRequest(BILLING_STATUS_STATE_KEY, () =>
    $authFetch<BillingStatusResponse>(BILLING_STATUS_ENDPOINT),
  );
}
