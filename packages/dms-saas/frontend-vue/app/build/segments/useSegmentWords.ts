import { formatMinorUnits } from '../../composables/useMoneyFormat'
import { isSegmentGroup, isSegmentWorkspaceRef } from './tree'
import type { SegmentCatalog } from './useSegmentCatalog'
import type {
	SegmentCondition,
	SegmentConditionGroup,
	SegmentFieldDefinition,
	SegmentFieldType,
	SegmentNode,
	SegmentOperator,
	SegmentScalar,
	SegmentScope,
	SegmentValue,
	SegmentWordToken,
	SegmentWorkspaceRef,
} from './types'

const I18N = 'saas.segments'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
const BOOLEAN_TONES = new Map<string, string>([
	['true', 'success'],
	['false', 'neutral'],
])

/** One piece of rules read in words: a rule, or the AND / OR joining two. */
export type SegmentRulePart =
	| { kind: 'rule'; tokens: SegmentWordToken[] }
	| { kind: 'join'; text: string }

/**
 * `compact` collapses nested groups ("any of 3 conditions"), for a table
 * cell; `full` spells every rule out.
 */
export type SegmentRulesMode = 'compact' | 'full'

const OPERATOR_FAMILY = new Map<SegmentFieldType, string>([
	['enum', 'enum'],
	['enum:plan', 'enum'],
	['boolean', 'boolean'],
])

type ValueFormatter = (
	field: SegmentFieldDefinition,
	value: SegmentScalar | null,
) => SegmentWordToken

function text(value: string): SegmentWordToken {
	return { text: value }
}

/** Words for the values of rules, in the UI locale. */
function useValueWords(catalog: SegmentCatalog) {
	const { t, locale } = useI18n()

	function enumToken(
		field: SegmentFieldDefinition,
		value: SegmentScalar | null,
	): SegmentWordToken {
		const key = String(value)
		if (field.type === 'enum:plan') {
			const plan = catalog.catalog.value.plans.find((p) => p._id === key)
			return { text: plan?.name ?? t(`${I18N}.unknown_plan`), tone: 'neutral' }
		}
		const option = field.enumOptions?.find((o) => o.value === key)
		return {
			text: option ? t(option.labelKey) : key,
			tone: option?.tone ?? 'neutral',
		}
	}

	const quotedToken: ValueFormatter = (_field, value) =>
		text(`“${String(value ?? '')}”`)

	const SCALAR_FORMATTERS = new Map<SegmentFieldType, ValueFormatter>([
		[
			'boolean',
			(_field, value) => {
				const isTrue = value === true || value === 'true'
				return {
					text: t(`${I18N}.boolean.${isTrue}`),
					tone: BOOLEAN_TONES.get(String(isTrue)),
				}
			},
		],
		[
			'date',
			(_field, value) =>
				text(formatDate(value, locale.value, DAY_FORMAT) ?? String(value)),
		],
		['number', (field, value) => text(numberText(field, Number(value)))],
		['string', quotedToken],
	])

	function numberText(field: SegmentFieldDefinition, value: number): string {
		if (field.unit === 'currency') {
			return formatMinorUnits(value, null, locale.value)
		}
		if (field.unit === 'days') {
			return t(`${I18N}.units.days`, { count: value }, value)
		}
		return new Intl.NumberFormat(locale.value).format(value)
	}

	function valueTokens(
		field: SegmentFieldDefinition | undefined,
		value: SegmentValue,
	): SegmentWordToken[] {
		if (!field) return [text(String(value ?? ''))]
		const values = Array.isArray(value) ? value : [value]
		const isEnum = field.type === 'enum' || field.type === 'enum:plan'
		const format: ValueFormatter = isEnum
			? enumToken
			: (SCALAR_FORMATTERS.get(field.type) ?? quotedToken)
		if (values.length === 0) return [text(t(`${I18N}.no_value`))]
		return values.map((entry) => format(field, entry))
	}

	return { valueTokens }
}

/**
 * Words for fields, operators, values and whole rules, in the UI locale.
 * `groupParts` reads rules in words, the parts joined by AND / OR.
 */
export function useSegmentWords(catalog: SegmentCatalog) {
	const { t } = useI18n()
	const { valueTokens } = useValueWords(catalog)

	function operatorFamily(field: SegmentFieldDefinition | undefined): string {
		if (!field) return 'string'
		return OPERATOR_FAMILY.get(field.type) ?? field.valueKind
	}

	function operatorLabel(
		field: SegmentFieldDefinition | undefined,
		operator: SegmentOperator,
	): string {
		return t(`${I18N}.operators.${operatorFamily(field)}.${operator}`)
	}

	function fieldLabel(field: SegmentFieldDefinition | undefined): string {
		return field ? t(field.labelKey) : t(`${I18N}.unknown_field`)
	}

	function conditionTokens(
		condition: SegmentCondition,
		scope: SegmentScope,
	): SegmentWordToken[] {
		const field = catalog.findField(scope, condition.field)
		return [
			{ text: fieldLabel(field), isStrong: true },
			text(operatorLabel(field, condition.operator)),
			...valueTokens(field, condition.value),
		]
	}

	function refHead(ref: SegmentWorkspaceRef): SegmentWordToken[] {
		const role = ref.role === 'owner' ? 'owner' : 'member'
		const names = ref.workspaceNames ?? []
		const target = names.length
			? names.join(', ')
			: t(`${I18N}.rules.quantifier.${ref.quantifier}`)
		return [
			{ text: t(`${I18N}.rules.role.${role}`), isStrong: true },
			text(target),
			text(t(`${I18N}.rules.where`)),
		]
	}

	function nodeParts(
		node: SegmentNode,
		scope: SegmentScope,
		mode: SegmentRulesMode,
	): SegmentRulePart[] {
		if (isSegmentWorkspaceRef(node)) {
			return [
				{ kind: 'rule', tokens: refHead(node) },
				...groupParts(node.conditions, 'workspace', mode),
			]
		}
		if (isSegmentGroup(node)) return nestedGroupParts(node, scope, mode)
		return [{ kind: 'rule', tokens: conditionTokens(node, scope) }]
	}

	function nestedGroupParts(
		group: SegmentConditionGroup,
		scope: SegmentScope,
		mode: SegmentRulesMode,
	): SegmentRulePart[] {
		if (mode === 'full') {
			return [
				{ kind: 'rule', tokens: [text('(')] },
				...groupParts(group, scope, mode),
				{ kind: 'rule', tokens: [text(')')] },
			]
		}
		const count = group.conditions.length
		return [
			{
				kind: 'rule',
				tokens: [
					text(t(`${I18N}.rules.group.${group.logical}`, { count }, count)),
				],
			},
		]
	}

	function groupParts(
		group: SegmentConditionGroup,
		scope: SegmentScope,
		mode: SegmentRulesMode,
	): SegmentRulePart[] {
		const join = t(`${I18N}.conditions.${group.logical}`)
		return group.conditions.flatMap((node, index) => [
			...(index > 0 ? [{ kind: 'join' as const, text: join }] : []),
			...nodeParts(node, scope, mode),
		])
	}

	return {
		fieldLabel,
		operatorLabel,
		valueTokens,
		conditionTokens,
		groupParts,
	}
}
