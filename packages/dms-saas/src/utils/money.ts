const DEFAULT_MINOR_DIGITS = 2;
const DECIMAL_BASE = 10;

/** Decimal places of a currency's minor unit, as Stripe counts them: 2 for EUR, 0 for JPY. */
function currencyMinorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? DEFAULT_MINOR_DIGITS
    );
  } catch {
    return DEFAULT_MINOR_DIGITS;
  }
}

/**
 * An amount in major units (a plan's `49.5` euros) as the minor units Stripe
 * and the money params use (`4950` cents), rounded to the currency's unit.
 */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * DECIMAL_BASE ** currencyMinorDigits(currency));
}

/** Minor units (`4950` cents) as the major-unit amount (`49.5` euros). */
export function fromMinorUnits(amount: number, currency: string): number {
  return amount / DECIMAL_BASE ** currencyMinorDigits(currency);
}
