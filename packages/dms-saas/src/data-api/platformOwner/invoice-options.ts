import { assert } from "@antelopejs/interface-api-util";
import type { TableViewGuards } from "@antelopejs/interface-dms/base/types/guards";
import type { TableScope } from "./table-scope";

const HTTP_NOT_FOUND = 404;
const INVOICE_DOCUMENT_TYPE = "invoice";

/** Mandatory invoice constraint, merged with request filters by Data API. */
export const INVOICE_LIST_OPTIONS = {
  filters: { documentType: [INVOICE_DOCUMENT_TYPE, "eq"] },
} satisfies TableScope;

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
