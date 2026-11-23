import { formatMajorUnits } from './useMoneyFormat'
import {
	isPlanFeatureValue,
	PLAN_UNLIMITED,
	type PlanFeatureValue,
} from '../build/plan-catalog'

/** A number feature reads `0` as off, `-1` as unlimited, n ≥ 1 as a limit. */
const OFF_NUMERIC_VALUE = 0
const EMPTY_LABEL = '—'
const INCLUDED_LABEL = '✓'
const EXCLUDED_LABEL = '—'
const PRICE_UNIT_PREFIX = 'per '
const UNIT_FORMS_SEPARATOR = '|'
const SINGULAR_PLURAL_CATEGORY = 'one'
const UNIT_LABEL_KEY_PREFIX = 'saas.workspace.plan.units'
const MAX_QUANTITY_FRACTION_DIGITS = 2
const MIN_PRICE_FRACTION_DIGITS = 2
const MAX_PRICE_SIGNIFICANT_DIGITS = 3
/** Upper bound `Intl.NumberFormat` accepts for fraction digits. */
const MAX_FRACTION_DIGITS = 20
const BYTES_PER_KILOBYTE = 1_000

/**
 * One way of showing a unit: how many stored units it holds, and the i18n
 * key of a message node with a `quantity` message (`{value}`, pluralised on
 * the scaled value) and a `price` message (`{price}`).
 */
export interface PlanFeatureUnitScale {
	label: string
	size: number
}

/**
 * How a stored unit reads on a plan page. Quantities take the largest scale
 * they fill; a price reads per `priceScale` of the unit.
 */
export interface PlanFeatureUnitRule {
	scales: PlanFeatureUnitScale[]
	priceScale: PlanFeatureUnitScale
}

type UnitKind = 'quantity' | 'price'

/** Translates unit label keys, pluralised on `count`. */
export type UnitLabelTranslator = (
	key: string,
	params: Record<string, string>,
	count: number,
) => string

/** Everything the formatter needs besides the value, kept Vue-free for tests. */
export interface PlanFeatureFormatContext {
	locale: string
	/** Currency the plan is billed in; prices and money amounts read in it. */
	currency: string | null
	unlimitedLabel: string
	translateUnit: UnitLabelTranslator
	/**
	 * Renders a stored text value through the DMS display string convention:
	 * a `$key` is translated, anything else is returned as is.
	 */
	translateText: (text: string) => string
}

/** The part of a feature definition that decides how its value reads. */
export interface FormattableFeature {
	valueType: string
	unit: string | null
}

type UnitScales = readonly [PlanFeatureUnitScale, ...PlanFeatureUnitScale[]]

/** A unit rule whose scales were checked non-empty when it was registered. */
interface ResolvedUnitRule {
	scales: UnitScales
	priceScale: PlanFeatureUnitScale
}

type FeatureValueFormatter = (
	value: PlanFeatureValue,
	unit: string | null,
	context: PlanFeatureFormatContext,
) => string

/** A built-in scale, labelled under dms-saas's own unit messages. */
function builtInScale(name: string, size: number): PlanFeatureUnitScale {
	return { label: `${UNIT_LABEL_KEY_PREFIX}.${name}`, size }
}

const GIGABYTE_SCALE = builtInScale('gigabyte', BYTES_PER_KILOBYTE ** 3)
const BYTE_SCALES: UnitScales = [
	builtInScale('byte', 1),
	builtInScale('kilobyte', BYTES_PER_KILOBYTE),
	builtInScale('megabyte', BYTES_PER_KILOBYTE ** 2),
	GIGABYTE_SCALE,
	builtInScale('terabyte', BYTES_PER_KILOBYTE ** 4),
]
const MINUTE_SCALE = builtInScale('minute', 1)

const BYTE_RULE: ResolvedUnitRule = {
	scales: BYTE_SCALES,
	priceScale: GIGABYTE_SCALE,
}
const MINUTE_RULE: ResolvedUnitRule = {
	scales: [MINUTE_SCALE],
	priceScale: MINUTE_SCALE,
}

/**
 * Generic units dms-saas knows, normalised to lower case. A unit missing here
 * and from the registry still reads, as a grouped number followed by the unit
 * verbatim.
 */
const BUILT_IN_UNIT_RULES = new Map<string, ResolvedUnitRule>([
	['byte', BYTE_RULE],
	['bytes', BYTE_RULE],
	['minute', MINUTE_RULE],
	['minutes', MINUTE_RULE],
])

/**
 * Units consumer modules registered. Registration happens at plugin setup,
 * on the server and in the browser alike, and always maps a unit to the same
 * rule, so one module-level map is safe to share across SSR requests.
 */
const registeredUnitRules = new Map<string, ResolvedUnitRule>()

function normalizeUnit(unit: string): string {
	return unit.trim().toLowerCase()
}

function unitForms(unit: string): string[] {
	return unit
		.split(UNIT_FORMS_SEPARATOR)
		.map((form) => form.trim())
		.filter((form) => form.length > 0)
}

/**
 * The form of a unit agreeing with `count` in `locale`. A unit written
 * `singular | plural`, as an i18n message is (`project | projects`), reads
 * `1 project` and `3 projects` — and `1,5 projet` in French, whose singular
 * goes up to two. A unit with one form reads as written.
 *
 * @param unit Unit as stored, in the reader's language
 * @param count The number it follows
 * @param locale Reader's locale, for its plural rules
 */
export function agreeUnit(unit: string, count: number, locale: string): string {
	const forms = unitForms(unit)
	const singular = forms[0]
	const plural = forms.at(-1)
	if (forms.length < 2 || singular === undefined || plural === undefined) {
		return singular ?? ''
	}
	const category = new Intl.PluralRules(locale).select(count)
	return category === SINGULAR_PLURAL_CATEGORY ? singular : plural
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
	const [smallest, ...larger] = [...rule.scales].sort(
		(left, right) => left.size - right.size,
	)
	if (
		smallest === undefined ||
		![smallest, ...larger, rule.priceScale].every(
			(candidate) => candidate.size > 0,
		)
	) {
		throw new Error(
			'Invalid plan feature unit rule: expected at least one scale, all with a positive size',
		)
	}
	for (const name of [unit].flat()) {
		registeredUnitRules.set(normalizeUnit(name), {
			scales: [smallest, ...larger],
			priceScale: rule.priceScale,
		})
	}
}

function findUnitRule(base: string): ResolvedUnitRule | undefined {
	return registeredUnitRules.get(base) ?? BUILT_IN_UNIT_RULES.get(base)
}

/** Units whose value is an amount of the plan's currency. */
const MONEY_UNITS = new Set(['currency', 'currency unit', 'currency units'])

interface ParsedUnit {
	kind: UnitKind
	base: string
}

/** The plural form names the unit for the rules: `byte | bytes` is `bytes`. */
function parseUnit(unit: string): ParsedUnit {
	const normalized = normalizeUnit(unitForms(unit).at(-1) ?? unit)
	if (normalized.startsWith(PRICE_UNIT_PREFIX)) {
		return {
			kind: 'price',
			base: normalized.slice(PRICE_UNIT_PREFIX.length).trim(),
		}
	}
	return { kind: 'quantity', base: normalized }
}

function formatNumber(value: number, locale: string): string {
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: MAX_QUANTITY_FRACTION_DIGITS,
	}).format(value)
}

/**
 * Fraction digits keeping `MAX_PRICE_SIGNIFICANT_DIGITS` of a price, never
 * fewer than a currency's usual two.
 */
function priceFractionDigits(value: number): number {
	if (value === 0) return MIN_PRICE_FRACTION_DIGITS
	const magnitude = Math.floor(Math.log10(Math.abs(value)))
	const significant = MAX_PRICE_SIGNIFICANT_DIGITS - 1 - magnitude
	return Math.min(
		MAX_FRACTION_DIGITS,
		Math.max(MIN_PRICE_FRACTION_DIGITS, significant),
	)
}

/**
 * Unit prices are often fractions of a cent: keep three significant digits
 * below a cent instead of rounding them to a misleading zero.
 */
function formatPrice(value: number, context: PlanFeatureFormatContext): string {
	if (!context.currency) return formatNumber(value, context.locale)
	return new Intl.NumberFormat(context.locale, {
		style: 'currency',
		currency: context.currency.toUpperCase(),
		minimumFractionDigits: MIN_PRICE_FRACTION_DIGITS,
		maximumFractionDigits: priceFractionDigits(value),
	}).format(value)
}

function pickScale(scales: UnitScales, value: number): PlanFeatureUnitScale {
	const magnitude = Math.abs(value)
	const fitting = scales.filter((candidate) => candidate.size <= magnitude)
	return fitting.at(-1) ?? scales[0]
}

function unitLabelKey(label: string, kind: UnitKind): string {
	return `${label}.${kind}`
}

function formatQuantityInRule(
	value: number,
	rule: ResolvedUnitRule,
	context: PlanFeatureFormatContext,
): string {
	const chosen = pickScale(rule.scales, value)
	const scaled = value / chosen.size
	return context.translateUnit(
		unitLabelKey(chosen.label, 'quantity'),
		{ value: formatNumber(scaled, context.locale) },
		scaled,
	)
}

function formatPriceInRule(
	value: number,
	rule: ResolvedUnitRule,
	context: PlanFeatureFormatContext,
): string {
	const scaled = value * rule.priceScale.size
	return context.translateUnit(
		unitLabelKey(rule.priceScale.label, 'price'),
		{ price: formatPrice(scaled, context) },
		1,
	)
}

function formatWithUnknownUnit(
	value: number,
	parsed: ParsedUnit,
	unit: string,
	context: PlanFeatureFormatContext,
): string {
	const amount =
		parsed.kind === 'price'
			? formatPrice(value, context)
			: formatNumber(value, context.locale)
	return `${amount} ${agreeUnit(unit, value, context.locale)}`
}

function formatNumberWithUnit(
	value: number,
	unit: string,
	context: PlanFeatureFormatContext,
): string {
	const parsed = parseUnit(unit)
	if (parsed.kind === 'quantity' && MONEY_UNITS.has(parsed.base)) {
		return formatMajorUnits(value, context.currency, context.locale)
	}
	const rule = findUnitRule(parsed.base)
	if (!rule) return formatWithUnknownUnit(value, parsed, unit, context)
	return parsed.kind === 'price'
		? formatPriceInRule(value, rule, context)
		: formatQuantityInRule(value, rule, context)
}

function formatBoolean(value: PlanFeatureValue): string {
	return value === true ? INCLUDED_LABEL : EXCLUDED_LABEL
}

/**
 * A unit price of 0 is free, not off: only a quantity of 0 turns a number
 * feature off.
 */
function isUnitPrice(unit: string | null): boolean {
	return !!unit?.trim() && parseUnit(unit).kind === 'price'
}

function formatNumeric(
	value: PlanFeatureValue,
	unit: string | null,
	context: PlanFeatureFormatContext,
): string {
	const numeric = Number(value)
	if (Number.isNaN(numeric)) return EMPTY_LABEL
	if (numeric === OFF_NUMERIC_VALUE && !isUnitPrice(unit)) return EXCLUDED_LABEL
	if (numeric === PLAN_UNLIMITED) return context.unlimitedLabel
	if (!unit?.trim()) return formatNumber(numeric, context.locale)
	return formatNumberWithUnit(numeric, unit, context)
}

function formatText(
	value: PlanFeatureValue,
	unit: string | null,
	context: PlanFeatureFormatContext,
): string {
	const text = String(value).trim()
	if (!text) return EMPTY_LABEL
	const shown = context.translateText(text)
	const count = Number(text)
	return unit
		? `${shown} ${agreeUnit(unit, Number.isNaN(count) ? Infinity : count, context.locale)}`
		: shown
}

const FORMATTERS = new Map<string, FeatureValueFormatter>([
	['boolean', formatBoolean],
	['number', formatNumeric],
	['string', formatText],
])

/**
 * Renders a plan's feature value for people: a number feature's `-1` reads as
 * unlimited (the convention `maxMembers` already uses) and its `0` as off (—),
 * the same three states the plan editor sets; booleans as ✓/—, numbers grouped in
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
	value: PlanFeatureValue | undefined,
	context: PlanFeatureFormatContext,
): string {
	if (value === undefined || value === null || value === '') {
		return EMPTY_LABEL
	}
	const formatter = FORMATTERS.get(feature.valueType)
	if (!formatter) return String(value)
	return formatter(value, feature.unit, context)
}

/** Locale-bound view of {@link formatPlanFeatureValue}, for components. */
export function usePlanFeatureFormat() {
	const { t, locale } = useI18n()
	const { processI18n } = useTranslation()

	function formatFeatureValue(
		feature: TenantPlanFeature,
		value: unknown,
		currency: string | null = null,
	): string {
		return formatPlanFeatureValue(
			feature,
			isPlanFeatureValue(value) ? value : undefined,
			{
				locale: locale.value,
				currency,
				unlimitedLabel: t('saas.workspace.plan.unlimited'),
				translateUnit: (key, params, count) => t(key, params, count),
				translateText: (text) => processI18n(text),
			},
		)
	}

	return { formatFeatureValue }
}
