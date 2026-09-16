const UNLIMITED_NUMERIC_VALUE = -1;
const EMPTY_LABEL = "—";
const INCLUDED_LABEL = "✓";
const EXCLUDED_LABEL = "–";

type FeatureValueFormatter = (
  value: unknown,
  unit: string | null,
  unlimitedLabel: string,
) => string;

function formatBoolean(value: unknown): string {
  return value ? INCLUDED_LABEL : EXCLUDED_LABEL;
}

function formatNumeric(
  value: unknown,
  unit: string | null,
  unlimitedLabel: string,
): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return EMPTY_LABEL;
  if (numeric === UNLIMITED_NUMERIC_VALUE) return unlimitedLabel;
  return unit ? `${numeric} ${unit}` : String(numeric);
}

function formatText(value: unknown, unit: string | null): string {
  const text = String(value).trim();
  if (!text) return EMPTY_LABEL;
  return unit ? `${text} ${unit}` : text;
}

const FORMATTERS: Record<string, FeatureValueFormatter> = {
  boolean: (value) => formatBoolean(value),
  number: (value, unit, unlimitedLabel) =>
    formatNumeric(value, unit, unlimitedLabel),
  string: (value, unit) => formatText(value, unit),
};

/**
 * Renders a plan's feature value the way the comparison table shows it, with
 * `-1` reading as unlimited — the same convention `maxMembers` already uses.
 */
export function usePlanFeatureFormat() {
  const { t } = useI18n();

  function formatFeatureValue(
    feature: TenantPlanFeature,
    value: unknown,
  ): string {
    if (value === undefined || value === null || value === "") {
      return EMPTY_LABEL;
    }
    const formatter = FORMATTERS[feature.valueType];
    if (!formatter) return String(value);
    return formatter(value, feature.unit, t("saas.workspace.plan.unlimited"));
  }

  return { formatFeatureValue };
}
