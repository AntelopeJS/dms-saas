import { assert } from "@antelopejs/interface-api-util";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type { TableViewGuards } from "@antelopejs/interface-dms/base/types/guards";

const HTTP_NOT_FOUND = 404;

/** Mandatory invoice constraint, merged with request filters by Data API. */
export const INVOICE_LIST_OPTIONS = {
  filters: { documentType: ["invoice", "eq"] },
} satisfies Parameters.ListParameters;

/** Excludes credit-note projections while preserving legacy invoice reads. */
export const INVOICE_GUARDS: TableViewGuards = {
  get(_ctx, { current }) {
    assert(
      current.documentType !== "credit_note",
      HTTP_NOT_FOUND,
      "saas.errors.invoice.not_found",
    );
  },
};
