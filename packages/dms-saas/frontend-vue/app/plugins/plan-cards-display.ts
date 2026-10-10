import PlanCardsDisplay from '../components/PlanCardsDisplay.vue'
import { formatPlanAmount } from '../build/plan-catalog'

const PLAN_CARDS_DISPLAY_ID = 'saas:plan-cards'
const PLAN_CARDS_DISPLAY_LABEL = 'saas.catalog.plans.display.cards'
const PLAN_CARDS_DISPLAY_ICON = 'i-ph-cards'
const PLAN_CARDS_DISPLAY_ORDER = 5
const EMPTY_CELL = '—'
const UNLIMITED_MEMBERS = -1
const DEFAULT_CURRENCY_FIELD = 'currency'

interface PlanMoneyOptions {
	currencyField?: string
}

type Row = Record<string, unknown> | undefined

export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	const { $i18n } = useDmsApp()

	registerTableViewDisplay({
		id: PLAN_CARDS_DISPLAY_ID,
		label: PLAN_CARDS_DISPLAY_LABEL,
		icon: PLAN_CARDS_DISPLAY_ICON,
		order: PLAN_CARDS_DISPLAY_ORDER,
		component: PlanCardsDisplay,
	})

	// An amount in the currency of its own row, which the built-in price cell
	// cannot know.
	registerDataType({
		id: 'saas:plan-money',
		formatter: {
			default: (value: unknown, locale: string, options: unknown, row: Row) => {
				if (typeof value !== 'number') return EMPTY_CELL
				const field =
					(options as PlanMoneyOptions | undefined)?.currencyField ??
					DEFAULT_CURRENCY_FIELD
				return formatPlanAmount(value, String(row?.[field] ?? 'EUR'), locale)
			},
		},
	})

	registerDataType({
		id: 'saas:plan-member-cap',
		formatter: {
			default: (value: unknown, locale: string) => {
				if (typeof value !== 'number') return EMPTY_CELL
				if (value === UNLIMITED_MEMBERS) {
					return $i18n.t('saas.catalog.plans.unlimited')
				}
				return new Intl.NumberFormat(locale).format(value)
			},
		},
	})

	registerDataType({
		id: 'saas:feature-usage',
		formatter: {
			default: (value: unknown) => {
				const count = typeof value === 'number' ? value : 0
				return count === 0
					? $i18n.t('saas.catalog.features.used_by_none')
					: $i18n.t('saas.catalog.features.used_by', { count }, count)
			},
		},
	})
})
