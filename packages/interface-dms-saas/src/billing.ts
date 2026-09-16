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
