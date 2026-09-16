import { getStripeClient } from "./client";

/** Stripe-owned balance fields for an active customer. */
export interface AvailableStripeCustomerBalance {
  status: "available";
  balanceMinorUnits: number;
  currency: string | null;
}

/** Balance marker returned when Stripe reports a deleted customer. */
export interface DeletedStripeCustomerBalance {
  status: "deleted";
  balanceMinorUnits: null;
  currency: null;
}

/** Stripe-owned balance fields needed outside the payment adapter. */
export type StripeCustomerBalanceSnapshot =
  | AvailableStripeCustomerBalance
  | DeletedStripeCustomerBalance;

/** Retrieve the current customer balance directly from Stripe. */
export async function retrieveStripeCustomerBalance(
  customerId: string,
): Promise<StripeCustomerBalanceSnapshot> {
  const customer = await getStripeClient().customers.retrieve(customerId);
  if (customer.deleted) {
    return { status: "deleted", balanceMinorUnits: null, currency: null };
  }
  return {
    status: "available",
    balanceMinorUnits: customer.balance,
    currency: customer.currency ?? null,
  };
}
