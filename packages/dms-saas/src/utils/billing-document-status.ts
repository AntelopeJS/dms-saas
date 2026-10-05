import type { FormComponents } from "@antelopejs/interface-dms/base/form-schema";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type { BillingDocumentStatus } from "../db";
import { CREDIT_NOTE_STATUSES, INVOICE_STATUSES } from "../db";

/** Credit notes mirrored into the invoices table carry their own `issued` status. */
const BILLING_DOCUMENT_STATUSES: readonly BillingDocumentStatus[] = [
  ...INVOICE_STATUSES,
  "issued",
];

function statusItems(
  statuses: readonly string[],
  namespace: string,
): FormComponents.SelectOption[] {
  return statuses.map((status) => ({
    label: `$${namespace}.${status}`,
    value: status,
  }));
}

/** Translated labels of every status a row of the invoices table can hold. */
export const BILLING_DOCUMENT_STATUS_ITEMS = statusItems(
  BILLING_DOCUMENT_STATUSES,
  "saas.invoices.status",
);

/** Translated labels of every status a row of the credit notes table can hold. */
export const CREDIT_NOTE_STATUS_ITEMS = statusItems(
  CREDIT_NOTE_STATUSES,
  "saas.credit_notes.status",
);

/** Renders a billing document status through its translated label. */
export function billingDocumentStatusType(): DefaultDataTypes.SelectType {
  return new DefaultDataTypes.SelectType({
    items: BILLING_DOCUMENT_STATUS_ITEMS,
  });
}

/** Renders a credit note status through its translated label. */
export function creditNoteStatusType(): DefaultDataTypes.SelectType {
  return new DefaultDataTypes.SelectType({ items: CREDIT_NOTE_STATUS_ITEMS });
}
