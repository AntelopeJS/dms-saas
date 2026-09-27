import { assert } from "@antelopejs/interface-api-util";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type { TableViewGuards } from "@antelopejs/interface-dms/base/types/guards";

const HTTP_NOT_FOUND = 404;
const INVOICE_DOCUMENT_TYPE = "invoice";

/** Mandatory invoice constraint, merged with request filters by Data API. */
export const INVOICE_LIST_OPTIONS = {
  filters: { documentType: [INVOICE_DOCUMENT_TYPE, "eq"] },
} satisfies Parameters.ListParameters;

/** Only invoice rows are readable; credit-note projections are not found. */
export const INVOICE_GUARDS: TableViewGuards = {
  get(_ctx, { current }) {
    assert(
      current.documentType === INVOICE_DOCUMENT_TYPE,
      HTTP_NOT_FOUND,
      "saas.errors.invoice.not_found",
    );
  },
};
