/**
 * An amount in major units, in its currency and the reader's locale
 * (`€6,900`, `6 900 €`). Whole amounts drop their decimals.
 *
 * @param amount Amount in major units
 * @param currency ISO 4217 code
 * @param locale Reader's locale
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : undefined,
  }).format(amount);
}
