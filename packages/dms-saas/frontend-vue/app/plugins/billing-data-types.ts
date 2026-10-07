import { defineAsyncComponent, defineComponent, h, resolveComponent } from 'vue'
import { billingDocumentTypeKey } from '../composables/useBillingDocumentType'
import { parseInvoiceLines } from '../composables/useInvoiceLines'
import { formatMinorUnits } from '../composables/useMoneyFormat'

// Loaded the first time a table draws one: most pages never need them.
const CreditReasonCell = defineAsyncComponent(
	() => import('../build/cells/CreditReasonCell.vue'),
)
const InvoiceStatusCell = defineAsyncComponent(
	() => import('../build/cells/InvoiceStatusCell.vue'),
)
const IssuerCell = defineAsyncComponent(
	() => import('../build/cells/IssuerCell.vue'),
)
const WorkspacePlanCell = defineAsyncComponent(
	() => import('../build/cells/WorkspacePlanCell.vue'),
)

const InvoiceLinesDisplay = defineComponent({
	name: 'InvoiceLinesDisplay',
	props: {
		modelValue: {
			type: [Array, String] as unknown as () => unknown,
			default: null,
		},
	},
	setup(props) {
		const lines = resolveComponent('DmsSaasInvoiceLines')
		return () => h(lines, { modelValue: props.modelValue })
	},
})

const PERIOD_FORMAT: Intl.DateTimeFormatOptions = {
	month: 'long',
	year: 'numeric',
}
const RANGE_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
}
const RANGE_FORMAT_WITH_YEAR: Intl.DateTimeFormatOptions = {
	...RANGE_FORMAT,
	year: 'numeric',
}
const NO_VALUE = '—'

type CellRow = Record<string, unknown> | undefined

/** The display options a cell reads its row fields from. */
type CellOptions = Record<string, string | undefined> | undefined

/** Where a period cell reads the end of the period. */
interface PeriodOptions {
	endField?: string
}

function toDate(value: unknown): Date | null {
	if (!(value instanceof Date) && typeof value !== 'string') return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

/** "Sep 29 – Oct 28", with the years once the period spans two. */
function formatPeriod(
	start: unknown,
	locale: string,
	options: unknown,
	row: CellRow,
): string {
	const from = toDate(start)
	if (!from) return NO_VALUE
	const endField = (options as PeriodOptions | undefined)?.endField
	const to = endField ? toDate(row?.[endField]) : null
	if (!to) return new Intl.DateTimeFormat(locale, RANGE_FORMAT).format(from)
	const isSameYear = from.getFullYear() === to.getFullYear()
	const format = isSameYear ? RANGE_FORMAT : RANGE_FORMAT_WITH_YEAR
	return new Intl.DateTimeFormat(locale, format).formatRange(from, to)
}

/** An amount in minor units, in the row's own currency. */
function formatRowMoney(value: unknown, locale: string, row: CellRow) {
	if (typeof value !== 'number') return value
	const currency = typeof row?.currency === 'string' ? row.currency : null
	return formatMinorUnits(value, currency, locale)
}

function registerOperatorCells(
	registerDataType: ReturnType<typeof useDataTypes>['registerDataType'],
): void {
	registerDataType({
		id: 'saas:invoice_status',
		formatter: {
			default: (value, _locale, _options, row) =>
				h(InvoiceStatusCell, { value, row }),
		},
	})
	registerDataType({
		id: 'saas:workspace_plan',
		formatter: {
			default: (value, _locale, options, row) =>
				h(WorkspacePlanCell, { value, row, options: options as CellOptions }),
		},
	})
	registerDataType({
		id: 'saas:period',
		formatter: { default: formatPeriod },
	})
	registerDataType({
		id: 'saas:credit_reason',
		formatter: {
			default: (value, _locale, options, row) =>
				h(CreditReasonCell, { value, row, options: options as CellOptions }),
			empty: (value, _locale, options, row) =>
				h(CreditReasonCell, { value, row, options: options as CellOptions }),
		},
	})
	registerDataType({
		id: 'saas:issuer',
		formatter: {
			default: (value) => h(IssuerCell, { value }),
			empty: (value) => h(IssuerCell, { value }),
		},
	})
}

export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	const nuxtApp = useDmsApp()
	registerDataType({
		id: 'billing_document_type',
		formatter: {
			default: (value: unknown) => {
				const key = billingDocumentTypeKey(value)
				return key ? nuxtApp.$i18n.t(key) : NO_VALUE
			},
		},
	})
	registerDataType({
		id: 'billing_period',
		formatter: {
			default: (value: unknown, locale: string) =>
				formatDate(value, locale, PERIOD_FORMAT) ?? NO_VALUE,
		},
	})
	registerDataType({
		id: 'money_cents',
		formatter: {
			default: (value, locale, _options, row) =>
				formatRowMoney(value, locale, row),
		},
	})
	registerDataType({
		id: 'invoice_lines',
		displayComponent: InvoiceLinesDisplay,
		formatter: {
			default: (value: unknown) => {
				const count = parseInvoiceLines(value).length
				return count ? String(count) : NO_VALUE
			},
		},
	})
	registerOperatorCells(registerDataType)
})
