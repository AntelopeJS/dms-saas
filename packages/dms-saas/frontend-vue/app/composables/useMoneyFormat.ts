export const MINOR_UNITS_PER_UNIT = 100;

const FALLBACK_CURRENCY = "EUR";

export interface MajorUnitsFormatOptions {
  /** Render a whole amount without decimals, e.g. `€20` instead of `€20.00`. */
  hideWholeAmountDecimals?: boolean;
}

export function formatMajorUnits(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
  options: MajorUnitsFormatOptions = {},
): string {
  if (typeof amount !== "number") return "—";
  const hasDecimalsToHide =
    options.hideWholeAmountDecimals === true && Number.isInteger(amount);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: (currency || FALLBACK_CURRENCY).toUpperCase(),
    minimumFractionDigits: hasDecimalsToHide ? 0 : undefined,
  }).format(amount);
}

/** Amounts mirrored from a payment provider are stored in minor units. */
export function formatMinorUnits(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string {
  if (typeof amount !== "number") return "—";
  return formatMajorUnits(amount / MINOR_UNITS_PER_UNIT, currency, locale);
}

/** Locale-bound view of the formatters above, for use inside components. */
export function useMoneyFormat() {
  const { locale } = useI18n();
  return {
    formatMinorUnits: (
      amount: number | null | undefined,
      currency: string | null | undefined,
    ) => formatMinorUnits(amount, currency, locale.value),
    formatMajorUnits: (
      amount: number | null | undefined,
      currency: string | null | undefined,
    ) => formatMajorUnits(amount, currency, locale.value),
  };
}
