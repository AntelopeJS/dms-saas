import { Filter } from "@antelopejs/interface-data-api/metadata";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

const STRING_TYPE = new DefaultDataTypes.StringType();

/**
 * Registers a string comparison filter (including the "is" mode used by
 * TableView `routeParamFilters`) on a field WITHOUT exposing it as a visible
 * `@Column`.
 *
 * Needed for partition/system fields such as `_instance`, or for raw ids like
 * `userId` that we don't want to surface as a column: the data-api only applies
 * a filter when the field is registered in its filter map. Without this the
 * hidden route-param filter is silently dropped and the table returns rows from
 * every instance/user (see interface-data-api components: filters are kept only
 * when `name in meta.filters`).
 *
 * The decorator targets the controller prototype, not its field values.
 */
export function HiddenStringFilter(): PropertyDecorator {
  return Filter<Record<string, unknown>>(
    STRING_TYPE.filter.bind(STRING_TYPE),
  ) as PropertyDecorator;
}
