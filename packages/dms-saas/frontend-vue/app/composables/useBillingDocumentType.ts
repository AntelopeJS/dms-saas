import { isText } from '../build/type-guards'
const BILLING_DOCUMENT_TYPE_KEYS = new Map([
	['invoice', 'saas.invoices.type.invoice'],
	['credit_note', 'saas.invoices.type.credit_note'],
])

/** Resolves the translation key of a billing document type, if it is known. */
export function billingDocumentTypeKey(value: unknown): string | null {
	return isText(value) ? (BILLING_DOCUMENT_TYPE_KEYS.get(value) ?? null) : null
}
