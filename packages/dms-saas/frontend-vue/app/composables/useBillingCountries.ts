export interface BillingCountryItem {
  value: string;
  label: string;
}

export interface BillingCountries {
  countryItems: BillingCountryItem[];
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

export function useBillingCountries(): BillingCountries {
  return {
    countryItems: BILLING_COUNTRY_CODES.map((code) => ({
      value: code,
      label: code,
    })),
  };
}
