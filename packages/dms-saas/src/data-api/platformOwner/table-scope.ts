import { DefaultRoutes } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type { FilterValue } from "@antelopejs/interface-data-api/metadata";

/**
 * Filters a table's routes always apply, merged by Data API with the ones a
 * request carries (the scope wins on a shared key): the rows outside it are
 * never listed, counted nor exported.
 */
export interface TableScope extends Parameters.ListParameters {
  filters: Record<string, FilterValue>;
}

/**
 * Wraps a list-like route (`list`, `select`, `count`, `countBatch`,
 * `exportStart`) so it applies the scope.
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
