import { defineComponent, h, resolveComponent } from 'vue'
import type { DataTypeFormatter } from '#dms-core/app/composables/data-types/useDataType'
import { formatPeriodRange } from '../build/period-range'
import { billingDocumentTypeKey } from '../composables/useBillingDocumentType'
import { parseInvoiceLines } from '../composables/useInvoiceLines'
import { formatMinorUnits } from '../composables/useMoneyFormat'

const InvoiceLinesDisplay = defineComponent({
	name: 'InvoiceLinesDisplay',
	props: {
		modelValue: {
			type: [Array, String],
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
const NO_VALUE = '—'

type CellRow = Parameters<DataTypeFormatter>[3]

/** Where a period cell reads the end of the period. */
interface PeriodOptions {
	endField?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isText(value: unknown): value is string {
	return typeof value === 'string'
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number'
}

function isDateInput(value: unknown): value is Date | string {
	return value instanceof Date || isText(value)
}

function isPeriodOptions(value: unknown): value is PeriodOptions {
	return (
		isRecord(value) && (value.endField === undefined || isText(value.endField))
	)
}

function parseDate(value: Date | string): Date | null {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

function toDate(value: unknown): Date | null {
	return isDateInput(value) ? parseDate(value) : null
}

function readRowDate(row: CellRow, field: string): Date | null {
	return row !== undefined && Object.hasOwn(row, field)
		? toDate(row[field])
		: null
}

/**
 * "Sep 29 – Oct 28", with the years once the period spans two, in the
 * reader's time zone like every other date of the console.
 */
function formatPeriod(
	from: Date | null,
	locale: string,
	endField: string | undefined,
	row: CellRow,
): string {
	if (!from) return NO_VALUE
	const to = endField ? readRowDate(row, endField) : null
	return formatPeriodRange(from, to, locale, regionalDateTimeFormat)
}

/** The currency a row states for its own amounts, if any. */
function rowCurrency(row: CellRow): string | null {
	const currency = row?.currency
	return isText(currency) ? currency : null
}

function registerPeriodCell(
	registerDataType: ReturnType<typeof useDataTypes>['registerDataType'],
): void {
	registerDataType({
		id: 'saas:period',
		formatter: {
			default: (start, locale, options, row) =>
				formatPeriod(
					toDate(start),
					locale,
					isPeriodOptions(options) ? options.endField : undefined,
					row,
				),
		},
	})
}

export default defineDmsPlugin(() => {
	const { registerDataType } = useDataTypes()
	const nuxtApp = useDmsApp()
	registerDataType({
		id: 'billing_document_type',
		formatter: {
			default: (value) => {
				const key = billingDocumentTypeKey(value)
				return key ? nuxtApp.$i18n.t(key) : NO_VALUE
			},
		},
	})
	registerDataType({
		id: 'billing_period',
		formatter: {
			default: (value, locale) =>
				formatDate(value, locale, PERIOD_FORMAT) ?? NO_VALUE,
		},
	})
	registerDataType({
		id: 'money_cents',
		formatter: {
			default: (value, locale, _options, row) =>
				isNumber(value)
					? formatMinorUnits(value, rowCurrency(row), locale)
					: value,
		},
	})
	registerDataType({
		id: 'invoice_lines',
		displayComponent: InvoiceLinesDisplay,
		formatter: {
			default: (value) => {
				const count = parseInvoiceLines(value).length
				return count ? String(count) : NO_VALUE
			},
		},
	})
	registerPeriodCell(registerDataType)
})
