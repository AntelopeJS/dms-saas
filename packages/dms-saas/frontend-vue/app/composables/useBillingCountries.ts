import { computed, type ComputedRef } from "vue";

export interface BillingCountryItem {
  value: string;
  label: string;
}

export interface BillingCountries {
  countryItems: ComputedRef<BillingCountryItem[]>;
}

const BILLING_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GB",
  "CH",
  "NO",
  "US",
  "CA",
  "AU",
  "NZ",
];

/**
 * Country choices labelled with their full name in the given locale, sorted
 * alphabetically for that locale. The stored value stays the ISO code Stripe
 * expects.
 *
 * @param locale BCP 47 locale the labels are rendered in
 */
export function buildBillingCountryItems(locale: string): BillingCountryItem[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return BILLING_COUNTRY_CODES.map((code) => ({
    value: code,
    label: names.of(code) ?? code,
  })).sort((left, right) => left.label.localeCompare(right.label, locale));
}

/** Full country name for an ISO code, or the code itself when unknown. */
export function formatBillingCountry(code: string, locale: string): string {
  return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
}

export function useBillingCountries(): BillingCountries {
  const { locale } = useI18n();
  return {
    countryItems: computed(() => buildBillingCountryItems(locale.value)),
  };
}
