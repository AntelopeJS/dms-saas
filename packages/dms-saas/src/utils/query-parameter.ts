/**
 * A query parameter as interface-api's `@Parameter(name, "query")` hands it
 * over: absent, `true` when the query names it with no value, else its text.
 */
export type QueryParameterValue = string | true | undefined;
