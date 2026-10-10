import type { RequestContext } from "@antelopejs/interface-api";
import { DefaultRoutes } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type {
  DataControllerCallback,
  DataControllerCallbackWithOptions,
  FilterValue,
} from "@antelopejs/interface-data-api/metadata";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";

const QUERY_FILTER_PREFIX = "filter_";

/**
 * Filters a table's routes always apply, merged by Data API with the ones a
 * request carries (the scope wins on a shared key): the rows outside it are
 * never listed, counted nor exported.
 */
export interface TableScope extends Parameters.ListParameters {
  filters: Record<string, FilterValue>;
}

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

/**
 * Wraps a list-like route (`list`, `select`, `count`, `exportStart`) so it
 * applies the scope.
 *
 * @param scope Filters to apply
 */
export function withTableScope(scope: TableScope) {
  return <O>(route: O) =>
    DefaultRoutes.WithOptions(
      route as Parameters<typeof DefaultRoutes.WithOptions>[0],
      scope,
    );
}

/** The scope as query parameters, the way a batch count query carries filters. */
function scopeQuery(scope: TableScope): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scope.filters).map(([key, [value, mode]]) => [
      `${QUERY_FILTER_PREFIX}${key}`,
      `${mode}:${value}`,
    ]),
  );
}

function scopeBatchBody(body: unknown, query: Record<string, string>) {
  const queries = (body as BatchCountBody | null)?.queries;
  if (!Array.isArray(queries)) return body;
  return {
    ...(body as object),
    queries: queries.map((entry) => ({
      ...entry,
      query: { ...entry?.query, ...query },
    })),
  };
}

/**
 * The tab counters' batch count under the scope: the batch reads its filters
 * from each query alone, not from route options, so the scope has to travel
 * in every query.
 *
 * @param scope Filters to apply
 */
export function scopedCountBatch(
  scope: TableScope,
): DataControllerCallbackWithOptions {
  const countBatch =
    TableViewRoutes.CountBatch as DataControllerCallbackWithOptions;
  const callback = countBatch.callback as DataControllerCallback;
  const func = callback.func as BatchCountFunc;
  const query = scopeQuery(scope);
  return {
    ...countBatch,
    callback: {
      ...callback,
      func(this: unknown, ctx: RequestContext, body: unknown, user: unknown) {
        return func.call(this, ctx, scopeBatchBody(body, query), user);
      },
    } as DataControllerCallback,
  };
}
