import { formatMajorUnits } from "./useMoneyFormat";
import {
  resolvePlanFeatureValueText,
  usePlanTranslationLookup,
} from "./usePlanFeatureLabel";

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
const MINUTES_PER_HOUR = 60;
/** Average month length (365.25 × 24 / 12, rounded), the usual cloud billing convention. */
const HOURS_PER_MONTH = 730;
const BYTES_PER_KILOBYTE = 1_000;

/** One way of showing a unit: its label and how many base units it holds. */
interface DisplayScale {
  label: string;
  size: number;
}

/**
 * How a stored unit reads on a plan page. Quantities take the largest scale
 * they fill; a price reads per `priceScale` of the unit.
 */
interface UnitRule {
  scales: DisplayScale[];
  priceScale: DisplayScale;
}

type UnitKind = "quantity" | "price";

/** Translates `saas.workspace.plan.units.*` keys, pluralised on `count`. */
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
  /** Translation of a text value, or null to show it as stored. */
  translateValue?: FeatureValueTranslator;
}

/** Translates a text feature value; `null` when no translation exists. */
export type FeatureValueTranslator = (
  featureId: string,
  value: string,
) => string | null;

/** The part of a feature definition that decides how its value reads. */
export interface FormattableFeature {
  featureId?: string;
  valueType: string;
  unit: string | null;
}

type FeatureValueFormatter = (
  value: unknown,
  feature: FormattableFeature,
  context: PlanFeatureFormatContext,
) => string;

function scale(label: string, size: number): DisplayScale {
  return { label, size };
}

function singleScaleRule(label: string, size: number): UnitRule {
  return { scales: [scale(label, size)], priceScale: scale(label, size) };
}

const BYTE_SCALES = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"].map(
  (label, power) => scale(label, BYTES_PER_KILOBYTE ** power),
);
const GIGABYTE_SCALE = BYTE_SCALES[3]!;

const BYTE_RULE: UnitRule = { scales: BYTE_SCALES, priceScale: GIGABYTE_SCALE };
const VCPU_MINUTE_RULE = singleScaleRule("vcpu_hour", MINUTES_PER_HOUR);
const GIB_MINUTE_RULE = singleScaleRule("gib_hour", MINUTES_PER_HOUR);
const GB_MINUTE_RULE = singleScaleRule("gb_hour", MINUTES_PER_HOUR);
const GB_HOUR_RULE = singleScaleRule("gb_month", HOURS_PER_MONTH);
const MINUTE_RULE = singleScaleRule("minute", 1);
const BUILD_MINUTE_RULE = singleScaleRule("build_minute", 1);

/**
 * Units a feature may declare, normalised to lower case and singular. A unit
 * missing here still reads, as a grouped number followed by the unit verbatim.
 */
const UNIT_RULES: Record<string, UnitRule> = {
  byte: BYTE_RULE,
  bytes: BYTE_RULE,
  "vcpu-minute": VCPU_MINUTE_RULE,
  "vcpu-minutes": VCPU_MINUTE_RULE,
  "gib-minute": GIB_MINUTE_RULE,
  "gib-minutes": GIB_MINUTE_RULE,
  "gb-minute": GB_MINUTE_RULE,
  "gb-minutes": GB_MINUTE_RULE,
  "gb-hour": GB_HOUR_RULE,
  "gb-hours": GB_HOUR_RULE,
  minute: MINUTE_RULE,
  minutes: MINUTE_RULE,
  "build minute": BUILD_MINUTE_RULE,
  "build minutes": BUILD_MINUTE_RULE,
};

/** Units whose value is an amount of the plan's currency. */
const MONEY_UNITS = new Set(["currency", "currency unit", "currency units"]);

interface ParsedUnit {
  kind: UnitKind;
  base: string;
}

function parseUnit(unit: string): ParsedUnit {
  const normalized = unit.trim().toLowerCase();
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

function pickScale(scales: DisplayScale[], value: number): DisplayScale {
  const magnitude = Math.abs(value);
  const fitting = scales.filter((candidate) => candidate.size <= magnitude);
  return fitting.at(-1) ?? scales[0]!;
}

function unitLabelKey(label: string, kind: UnitKind): string {
  return `${UNIT_LABEL_KEY_PREFIX}.${label}.${kind}`;
}

function formatQuantityInRule(
  value: number,
  rule: UnitRule,
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
  rule: UnitRule,
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
  const rule = UNIT_RULES[parsed.base];
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

function translateText(
  text: string,
  feature: FormattableFeature,
  context: PlanFeatureFormatContext,
): string {
  if (!feature.featureId || !context.translateValue) return text;
  return context.translateValue(feature.featureId, text) ?? text;
}

function formatText(
  value: unknown,
  feature: FormattableFeature,
  context: PlanFeatureFormatContext,
): string {
  const text = String(value).trim();
  if (!text) return EMPTY_LABEL;
  const shown = translateText(text, feature, context);
  return feature.unit ? `${shown} ${feature.unit}` : shown;
}

const FORMATTERS: Record<string, FeatureValueFormatter> = {
  boolean: (value) => formatBoolean(value),
  number: (value, feature, context) =>
    formatNumeric(value, feature.unit, context),
  string: formatText,
};

/**
 * Renders a plan's feature value for people: `-1` reads as unlimited (the
 * convention `maxMembers` already uses), booleans as ✓/—, numbers grouped in
 * the viewer's locale and scaled by unit — bytes to KB…TB, minute-based
 * usage to hours, GB-hours to GB-months, and `per <unit>` prices to the same
 * readable unit. Text values read through `context.translateValue` when the
 * feature carries its id.
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
  return formatter(value, feature, context);
}

/**
 * Locale-bound view of {@link formatPlanFeatureValue}, for components.
 *
 * @param prefixes Consumer prefixes text values translate under, from the
 *   tenant plan response
 */
export function usePlanFeatureFormat(
  prefixes: () => readonly string[] = () => [],
) {
  const { t, locale } = useI18n();
  const lookup = usePlanTranslationLookup();

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
      translateValue: (featureId, text) =>
        resolvePlanFeatureValueText(featureId, text, prefixes(), lookup),
    });
  }

  return { formatFeatureValue };
}
