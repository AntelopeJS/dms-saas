import { isNumber, isRecord, isText } from '../build/type-guards'
export interface InvoiceLine {
	description: string
	quantity: number | null
	amount: number
	currency?: string | null
	periodStart: string | Date | null
	periodEnd: string | Date | null
}

function isMoment(value: unknown): value is string | Date | null {
	return value === null || isText(value) || value instanceof Date
}

function isInvoiceLine(value: unknown): value is InvoiceLine {
	return (
		isRecord(value) &&
		isText(value.description) &&
		(value.quantity === null || isNumber(value.quantity)) &&
		isNumber(value.amount) &&
		(value.currency === undefined ||
			value.currency === null ||
			isText(value.currency)) &&
		isMoment(value.periodStart) &&
		isMoment(value.periodEnd)
	)
}

function parseJsonLines(json: string): InvoiceLine[] {
	try {
		const parsed: unknown = JSON.parse(json)
		return Array.isArray(parsed) ? parsed.filter(isInvoiceLine) : []
	} catch {
		return []
	}
}

/**
 * The mirror stores lines as an array, but the table view hands the raw column
 * value over, which may still be its JSON form.
 */
export function parseInvoiceLines(raw: unknown): InvoiceLine[] {
	if (Array.isArray(raw)) return raw.filter(isInvoiceLine)
	return isText(raw) ? parseJsonLines(raw) : []
}
