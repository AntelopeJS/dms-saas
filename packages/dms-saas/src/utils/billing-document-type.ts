import type { BlockText } from "@antelopejs/interface-dms/base";
import { RegisterDataType } from "@antelopejs/interface-dms/base/data-types";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { composed } from "../i18n/composed-text";

/** Discriminates invoices from credit notes in the tenant billing history. */
@RegisterDataType("billing_document_type")
export class BillingDocumentType extends DefaultDataTypes.StringType {}

const INVOICE = "invoice";
const CREDIT_NOTE = "credit_note";
const DOCUMENT_TYPE_KEY = "$saas.invoices.type";
const CREDIT_NOTE_FOR_KEY = "saas.tenant_billing.invoices.credit_note_for";

/** What a billing document's type field and the invoice it credits read from. */
export interface BillingDocumentRow {
  documentType?: string | null;
  parentInvoiceNumber?: string | null;
}

/**
 * The line naming a billing document under its number: "Invoice", "Credit
 * note", or "Credit note · for INV-0042" when the credited invoice is known.
 */
export function billingDocumentLine(row: BillingDocumentRow): BlockText {
  if (row.documentType !== CREDIT_NOTE)
    return `${DOCUMENT_TYPE_KEY}.${INVOICE}`;
  return row.parentInvoiceNumber
    ? composed(CREDIT_NOTE_FOR_KEY, { invoice: row.parentInvoiceNumber })
    : `${DOCUMENT_TYPE_KEY}.${CREDIT_NOTE}`;
}
