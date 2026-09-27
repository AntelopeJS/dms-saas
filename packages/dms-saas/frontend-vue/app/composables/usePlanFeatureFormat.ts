import { formatMajorUnits } from "./useMoneyFormat";

const UNLIMITED_NUMERIC_VALUE = -1;
const EMPTY_LABEL = "—";
const INCLUDED_LABEL = "✓";
const EXCLUDED_LABEL = "—";
const PRICE_UNIT_PREFIX = "per ";
const UNIT_LABEL_KEY_PREFIX = "saas.workspace.plan.units";
const MAX_QUANTITY_FRACTION_DIGITS = 2;
const MIN_PRICE_FRACTION_DIGITS = 2;
const MAX_PRICE_SIGNIFICANT_DIGITS = 3;
/** Upper bound `Intl.NumberFormat` accepts for fraction digits. */
const MAX_FRACTION_DIGITS = 20;
const BYTES_PER_KILOBYTE = 1_000;

/**
 * One way of showing a unit: how many stored units it holds, and the i18n
 * key of a message node with a `quantity` message (`{value}`, pluralised on
 * the scaled value) and a `price` message (`{price}`).
 */
export interface PlanFeatureUnitScale {
  label: string;
  size: number;
}

/**
 * How a stored unit reads on a plan page. Quantities take the largest scale
 * they fill; a price reads per `priceScale` of the unit.
 */
export interface PlanFeatureUnitRule {
  scales: PlanFeatureUnitScale[];
  priceScale: PlanFeatureUnitScale;
}

type UnitKind = "quantity" | "price";

/** Translates unit label keys, pluralised on `count`. */
export type UnitLabelTranslator = (
  key: string,
  params: Record<string, string>,
  count: number,
) => string;

/** Everything the formatter needs besides the value, kept Vue-free for tests. */
export interface PlanFeatureFormatContext {
  locale: string;
  /** Currency the plan is billed in; prices and money amounts read in it. */
  currency: string | null;
  unlimitedLabel: string;
  translateUnit: UnitLabelTranslator;
  /**
   * Renders a stored text value through the DMS display string convention:
   * a `$key` is translated, anything else is returned as is.
   */
  translateText: (text: string) => string;
}

/** The part of a feature definition that decides how its value reads. */
export interface FormattableFeature {
  valueType: string;
  unit: string | null;
}

type FeatureValueFormatter = (
  value: unknown,
  unit: string | null,
  context: PlanFeatureFormatContext,
) => string;

/** A built-in scale, labelled under dms-saas's own unit messages. */
function builtInScale(name: string, size: number): PlanFeatureUnitScale {
  return { label: `${UNIT_LABEL_KEY_PREFIX}.${name}`, size };
}

const BYTE_SCALES = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"].map(
  (name, power) => builtInScale(name, BYTES_PER_KILOBYTE ** power),
);
const GIGABYTE_SCALE = BYTE_SCALES[3]!;
const MINUTE_SCALE = builtInScale("minute", 1);

const BYTE_RULE: PlanFeatureUnitRule = {
  scales: BYTE_SCALES,
  priceScale: GIGABYTE_SCALE,
};
const MINUTE_RULE: PlanFeatureUnitRule = {
  scales: [MINUTE_SCALE],
  priceScale: MINUTE_SCALE,
};

/**
 * Generic units dms-saas knows, normalised to lower case. A unit missing here
 * and from the registry still reads, as a grouped number followed by the unit
 * verbatim.
 */
const BUILT_IN_UNIT_RULES = new Map<string, PlanFeatureUnitRule>([
  ["byte", BYTE_RULE],
  ["bytes", BYTE_RULE],
  ["minute", MINUTE_RULE],
  ["minutes", MINUTE_RULE],
]);

/**
 * Units consumer modules registered. Registration happens at plugin setup,
 * on the server and in the browser alike, and always maps a unit to the same
 * rule, so one module-level map is safe to share across SSR requests.
 */
const registeredUnitRules = new Map<string, PlanFeatureUnitRule>();

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

/**
 * Teaches the plan pages how a feature unit reads, e.g. vCPU-minutes shown
 * in vCPU-hours. Call it from a frontend plugin of the module declaring the
 * features; labels are full i18n keys that module ships in its own locales.
 * A registered unit takes precedence over a built-in one of the same name.
 *
 * @param unit Stored unit or its spellings (matched case-insensitively), without `per `
 * @param rule Display scales, in any order, and the scale prices read per
 * @throws When the rule has no scale or a scale is not a positive size
 */
export function registerPlanFeatureUnit(
  unit: string | string[],
  rule: PlanFeatureUnitRule,
): void {
  const scales = [...rule.scales].sort((left, right) => left.size - right.size);
  const isValid =
    scales.length > 0 &&
    [...scales, rule.priceScale].every((candidate) => candidate.size > 0);
  if (!isValid) {
    throw new Error(
      "Invalid plan feature unit rule: expected at least one scale, all with a positive size",
    );
  }
  for (const name of [unit].flat()) {
    registeredUnitRules.set(normalizeUnit(name), {
      scales,
      priceScale: rule.priceScale,
    });
  }
}

function findUnitRule(base: string): PlanFeatureUnitRule | undefined {
  return registeredUnitRules.get(base) ?? BUILT_IN_UNIT_RULES.get(base);
}

/** Units whose value is an amount of the plan's currency. */
const MONEY_UNITS = new Set(["currency", "currency unit", "currency units"]);

interface ParsedUnit {
  kind: UnitKind;
  base: string;
}

function parseUnit(unit: string): ParsedUnit {
  const normalized = normalizeUnit(unit);
  if (normalized.startsWith(PRICE_UNIT_PREFIX)) {
    return {
      kind: "price",
      base: normalized.slice(PRICE_UNIT_PREFIX.length).trim(),
    };
  }
  return { kind: "quantity", base: normalized };
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: MAX_QUANTITY_FRACTION_DIGITS,
  }).format(value);
}

/**
 * Fraction digits keeping `MAX_PRICE_SIGNIFICANT_DIGITS` of a price, never
 * fewer than a currency's usual two.
 */
function priceFractionDigits(value: number): number {
  if (value === 0) return MIN_PRICE_FRACTION_DIGITS;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const significant = MAX_PRICE_SIGNIFICANT_DIGITS - 1 - magnitude;
  return Math.min(
    MAX_FRACTION_DIGITS,
    Math.max(MIN_PRICE_FRACTION_DIGITS, significant),
  );
}

/**
 * Unit prices are often fractions of a cent: keep three significant digits
 * below a cent instead of rounding them to a misleading zero.
 */
function formatPrice(value: number, context: PlanFeatureFormatContext): string {
  if (!context.currency) return formatNumber(value, context.locale);
  return new Intl.NumberFormat(context.locale, {
    style: "currency",
    currency: context.currency.toUpperCase(),
    minimumFractionDigits: MIN_PRICE_FRACTION_DIGITS,
    maximumFractionDigits: priceFractionDigits(value),
  }).format(value);
}

function pickScale(
  scales: PlanFeatureUnitScale[],
  value: number,
): PlanFeatureUnitScale {
  const magnitude = Math.abs(value);
  const fitting = scales.filter((candidate) => candidate.size <= magnitude);
  return fitting.at(-1) ?? scales[0]!;
}

function unitLabelKey(label: string, kind: UnitKind): string {
  return `${label}.${kind}`;
}

function formatQuantityInRule(
  value: number,
  rule: PlanFeatureUnitRule,
  context: PlanFeatureFormatContext,
): string {
  const chosen = pickScale(rule.scales, value);
  const scaled = value / chosen.size;
  return context.translateUnit(
    unitLabelKey(chosen.label, "quantity"),
    { value: formatNumber(scaled, context.locale) },
    scaled,
  );
}

function formatPriceInRule(
  value: number,
  rule: PlanFeatureUnitRule,
  context: PlanFeatureFormatContext,
): string {
  const scaled = value * rule.priceScale.size;
  return context.translateUnit(
    unitLabelKey(rule.priceScale.label, "price"),
    { price: formatPrice(scaled, context) },
    1,
  );
}

function formatWithUnknownUnit(
  value: number,
  parsed: ParsedUnit,
  unit: string,
  context: PlanFeatureFormatContext,
): string {
  const amount =
    parsed.kind === "price"
      ? formatPrice(value, context)
      : formatNumber(value, context.locale);
  return `${amount} ${unit.trim()}`;
}

function formatNumberWithUnit(
  value: number,
  unit: string,
  context: PlanFeatureFormatContext,
): string {
  const parsed = parseUnit(unit);
  if (parsed.kind === "quantity" && MONEY_UNITS.has(parsed.base)) {
    return formatMajorUnits(value, context.currency, context.locale);
  }
  const rule = findUnitRule(parsed.base);
  if (!rule) return formatWithUnknownUnit(value, parsed, unit, context);
  return parsed.kind === "price"
    ? formatPriceInRule(value, rule, context)
    : formatQuantityInRule(value, rule, context);
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function formatBoolean(value: unknown): string {
  return isTruthyFlag(value) ? INCLUDED_LABEL : EXCLUDED_LABEL;
}

function formatNumeric(
  value: unknown,
  unit: string | null,
  context: PlanFeatureFormatContext,
): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return EMPTY_LABEL;
  if (numeric === UNLIMITED_NUMERIC_VALUE) return context.unlimitedLabel;
  if (!unit?.trim()) return formatNumber(numeric, context.locale);
  return formatNumberWithUnit(numeric, unit, context);
}

function formatText(
  value: unknown,
  unit: string | null,
  context: PlanFeatureFormatContext,
): string {
  const text = String(value).trim();
  if (!text) return EMPTY_LABEL;
  const shown = context.translateText(text);
  return unit ? `${shown} ${unit}` : shown;
}

const FORMATTERS: Record<string, FeatureValueFormatter> = {
  boolean: (value) => formatBoolean(value),
  number: formatNumeric,
  string: formatText,
};

/**
 * Renders a plan's feature value for people: `-1` reads as unlimited (the
 * convention `maxMembers` already uses), booleans as ✓/—, numbers grouped in
 * the viewer's locale and scaled by unit — bytes to KB…TB, plus any unit a
 * consumer registered — and `per <unit>` prices read per the same readable
 * unit. Text values follow the DMS display string convention: a `$key` is
 * translated, plain text is shown as stored.
 *
 * @param feature Feature definition carrying the value type and unit
 * @param value Value a plan sets for the feature
 * @param context Locale, plan currency and unit label translator
 */
export function formatPlanFeatureValue(
  feature: FormattableFeature,
  value: unknown,
  context: PlanFeatureFormatContext,
): string {
  if (value === undefined || value === null || value === "") {
    return EMPTY_LABEL;
  }
  const formatter = FORMATTERS[feature.valueType];
  if (!formatter) return String(value);
  return formatter(value, feature.unit, context);
}

/** Locale-bound view of {@link formatPlanFeatureValue}, for components. */
export function usePlanFeatureFormat() {
  const { t, locale } = useI18n();
  const { processI18n } = useTranslation();

  function formatFeatureValue(
    feature: TenantPlanFeature,
    value: unknown,
    currency: string | null = null,
  ): string {
    return formatPlanFeatureValue(feature, value, {
      locale: locale.value,
      currency,
      unlimitedLabel: t("saas.workspace.plan.unlimited"),
      translateUnit: (key, params, count) => t(key, params, count),
      translateText: (text) => processI18n(text),
    });
  }

  return { formatFeatureValue };
}
