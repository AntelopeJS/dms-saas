import { InterfaceFunction } from "@antelopejs/interface-core";

/** Minimal subscription state used to recognize current and legacy admin gifts. */
export interface ComplimentarySubscriptionState {
  isComplimentary?: boolean | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status?: string | null;
}

/** Explicit gift status wins; legacy grants had neither a customer nor a subscription. */
export function isComplimentarySubscription(
  subscription: ComplimentarySubscriptionState | null | undefined,
): boolean {
  if (!subscription) return false;
  return (
    subscription.isComplimentary ??
    (subscription.status !== "pending_payment" &&
      !subscription.stripeCustomerId &&
      !subscription.stripeSubscriptionId)
  );
}

/** Tenant identity established by a trusted server authentication boundary. */
export interface TenantCustomerBalanceScope {
  tenantId: string;
  userId: string;
}

/** Customer balance returned when Stripe has a usable billing currency. */
export interface AvailableTenantCustomerBalance {
  status: "available";
  balanceMinorUnits: number;
  currency: string;
}

/** Why no unambiguous customer balance can be returned. */
export type TenantCustomerBalanceAbsenceReason =
  | "complimentary"
  | "customer_not_configured"
  | "customer_deleted"
  | "currency_unavailable";

/** Explicit absence result for a missing customer or usable balance value. */
export interface AbsentTenantCustomerBalance {
  status: "absent";
  reason: TenantCustomerBalanceAbsenceReason;
  balanceMinorUnits: null;
  currency: null;
}

/**
 * Stripe customer balance for the authenticated request's current tenant.
 * Amounts use Stripe minor units: negative means customer credit, positive
 * means amount owed, and zero means settled. Currency is uppercase ISO 4217.
 */
export type TenantCustomerBalance =
  | AvailableTenantCustomerBalance
  | AbsentTenantCustomerBalance;

/** Resolve the authorized current tenant's Stripe customer balance. */
export const GetTenantCustomerBalance =
  InterfaceFunction<
    (scope: TenantCustomerBalanceScope) => Promise<TenantCustomerBalance>
  >();

/** Tenant identity the upcoming invoice preview is resolved for. */
export type UpcomingInvoicePreviewScope = TenantCustomerBalanceScope;

/**
 * What a preview line bills: the plan (`subscription`), a usage line quoted by
 * a registered invoice line items provider (`usage`), or any other pending
 * Stripe invoice item (`invoice_item`).
 */
export type UpcomingInvoiceLineKind = "subscription" | "usage" | "invoice_item";

/** One line of the upcoming invoice, as Stripe priced it. */
export interface UpcomingInvoiceLine {
  kind: UpcomingInvoiceLineKind;
  description: string | null;
  /** Line amount before tax, in minor units of the invoice currency. */
  amountMinorUnits: number;
  /** Tax Stripe computed on this line, in minor units. */
  taxMinorUnits: number;
  quantity: number | null;
  /** ISO 8601 bounds of the period the line covers. */
  periodStart: string;
  periodEnd: string;
  isProration: boolean;
  /** `<provider id>:<key>` of a usage line, null for any other kind. */
  usageLineKey: string | null;
}

/**
 * One tax Stripe Tax applied to the invoice. Rate details come from the Stripe
 * tax rate and stay null when Stripe does not report them.
 */
export interface UpcomingInvoiceTax {
  amountMinorUnits: number;
  taxableAmountMinorUnits: number | null;
  /** Whether the amount is already included in the line prices. */
  isInclusive: boolean;
  /** Effective rate in percent, e.g. `20` for 20 %. */
  ratePercentage: number | null;
  /** Uppercase ISO 3166-1 alpha-2 country the tax is owed in. */
  country: string | null;
  /** Stripe tax type, e.g. `vat`, `sales_tax`, `gst`. */
  taxType: string | null;
  displayName: string | null;
  jurisdiction: string | null;
  /** Stripe taxability reason, e.g. `standard_rated`, `reverse_charge`. */
  taxabilityReason: string | null;
  isReverseCharge: boolean;
}

/**
 * Upcoming invoice of a paid subscription, priced by Stripe including Stripe
 * Tax. Every amount is an integer in minor units of `currency`; Stripe is the
 * only source of these figures.
 */
export interface AvailableUpcomingInvoicePreview {
  status: "available";
  /** Uppercase ISO 4217 code. */
  currency: string;
  lines: UpcomingInvoiceLine[];
  /** Whether Stripe returned only the first page of `lines`; totals stay complete. */
  hasMoreLines: boolean;
  /** Sum of the lines before discounts and tax. */
  subtotalMinorUnits: number;
  /** Total after discounts, before tax. */
  totalExcludingTaxMinorUnits: number;
  taxMinorUnits: number;
  taxes: UpcomingInvoiceTax[];
  /** Uppercase country the tax was computed for, null when Stripe gives none. */
  taxCountry: string | null;
  isReverseCharge: boolean;
  /** Total including tax. */
  totalMinorUnits: number;
  /** What will be charged once the customer balance is applied. */
  amountDueMinorUnits: number;
  /** ISO 8601 bounds of the billing cycle the invoice closes. */
  periodStart: string;
  periodEnd: string;
  /** ISO 8601 date Stripe issues the invoice. */
  billingDate: string;
  /** ISO 8601 end of the usage quoted on the preview, null without usage lines. */
  usageThrough: string | null;
  /** ISO 8601 time the preview was computed; it may be served from cache. */
  computedAt: string;
}

/** Why the workspace has no upcoming invoice to preview. */
export type UpcomingInvoicePreviewAbsenceReason =
  | "complimentary"
  | "free_plan"
  | "customer_not_configured"
  | "subscription_not_configured"
  | "no_upcoming_invoice";

/** The workspace is not on a paid Stripe subscription with a next invoice. */
export interface AbsentUpcomingInvoicePreview {
  status: "absent";
  reason: UpcomingInvoicePreviewAbsenceReason;
  computedAt: string;
}

/** Why a paid subscription's next invoice cannot be priced right now. */
export type UpcomingInvoicePreviewUnavailableReason =
  | "stripe_not_configured"
  | "tax_not_configured"
  | "tax_location_invalid"
  | "tax_location_required"
  | "tax_calculation_failed"
  | "usage_unavailable"
  | "provider_error";

/** The next invoice exists but no exact figures can be given; the cause is logged. */
export interface UnavailableUpcomingInvoicePreview {
  status: "unavailable";
  reason: UpcomingInvoicePreviewUnavailableReason;
  computedAt: string;
}

/** Upcoming invoice of the current workspace, or an explicit reason why not. */
export type UpcomingInvoicePreview =
  | AvailableUpcomingInvoicePreview
  | AbsentUpcomingInvoicePreview
  | UnavailableUpcomingInvoicePreview;

/**
 * Resolve the authorized current tenant's upcoming invoice preview. Rejects
 * only a caller outside the tenant; Stripe failures resolve to `unavailable`.
 */
export const GetUpcomingInvoicePreview =
  InterfaceFunction<
    (scope: UpcomingInvoicePreviewScope) => Promise<UpcomingInvoicePreview>
  >();
