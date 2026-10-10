import type { RequestContext } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type {
  DataControllerCallback,
  DataControllerCallbackWithOptions,
} from "@antelopejs/interface-data-api/metadata";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";
import type { TableViewGuards } from "@antelopejs/interface-dms/base/types/guards";

const HTTP_NOT_FOUND = 404;
const INVOICE_DOCUMENT_TYPE = "invoice";
const DOCUMENT_TYPE_QUERY_FILTER = "filter_documentType";

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

interface BatchCountQuery {
  id: string;
  query: Record<string, unknown>;
}

interface BatchCountBody {
  queries?: BatchCountQuery[];
}

type BatchCountFunc = (
  this: unknown,
  ctx: RequestContext,
  body: unknown,
  user: unknown,
) => unknown;

/** Each count of the batch restricted to invoice rows, as the list is. */
function scopeToInvoices(body: unknown): unknown {
  const queries = (body as BatchCountBody | null)?.queries;
  if (!Array.isArray(queries)) return body;
  return {
    ...(body as object),
    queries: queries.map((entry) => ({
      ...entry,
      query: {
        ...entry?.query,
        [DOCUMENT_TYPE_QUERY_FILTER]: `eq:${INVOICE_DOCUMENT_TYPE}`,
      },
    })),
  };
}

const countBatch =
  TableViewRoutes.CountBatch as DataControllerCallbackWithOptions;
const countBatchCallback = countBatch.callback as DataControllerCallback;
const countBatchFunc = countBatchCallback.func as BatchCountFunc;

/**
 * The tab counters' batch count, restricted to invoice rows: the batch reads
 * its filters from each query alone, so the list's mandatory constraint
 * (credit notes share the table) has to travel in every query.
 */
export const INVOICE_COUNT_BATCH: DataControllerCallbackWithOptions = {
  ...countBatch,
  callback: {
    ...countBatchCallback,
    func(this: unknown, ctx: RequestContext, body: unknown, user: unknown) {
      return countBatchFunc.call(this, ctx, scopeToInvoices(body), user);
    },
  } as DataControllerCallback,
};
