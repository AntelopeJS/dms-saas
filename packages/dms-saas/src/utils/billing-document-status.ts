import type { FormComponents } from "@antelopejs/interface-dms/base/form-schema";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import type { BillingDocumentStatus } from "../db";
import { INVOICE_STATUSES } from "../db";

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

/** Renders a billing document status through its translated label. */
export function billingDocumentStatusType(): DefaultDataTypes.SelectType {
  return new DefaultDataTypes.SelectType({
    items: BILLING_DOCUMENT_STATUS_ITEMS,
  });
}
