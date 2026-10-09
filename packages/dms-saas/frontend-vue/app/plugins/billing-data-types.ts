import { defineComponent, h, resolveComponent } from 'vue'
import { billingDocumentTypeKey } from '../composables/useBillingDocumentType'
import { parseInvoiceLines } from '../composables/useInvoiceLines'
import { formatMinorUnits } from '../composables/useMoneyFormat'

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

function registerPeriodCell(
	registerDataType: ReturnType<typeof useDataTypes>['registerDataType'],
): void {
	registerDataType({
		id: 'saas:period',
		formatter: { default: formatPeriod },
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
	registerPeriodCell(registerDataType)
})
