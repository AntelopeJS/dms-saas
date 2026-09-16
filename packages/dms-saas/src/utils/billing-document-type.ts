import { RegisterDataType } from "@antelopejs/interface-dms/base/data-types";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

/** Discriminates invoices from credit notes in the tenant billing history. */
@RegisterDataType("billing_document_type")
export class BillingDocumentType extends DefaultDataTypes.StringType {}
