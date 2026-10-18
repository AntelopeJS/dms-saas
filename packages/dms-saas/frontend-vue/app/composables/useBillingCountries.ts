/**
 * Full country name for an ISO code, or the code itself when unknown. The
 * billing address picks its country from the DMS address input's list; the
 * stored value stays the ISO code Stripe expects.
 */
export function formatBillingCountry(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}
