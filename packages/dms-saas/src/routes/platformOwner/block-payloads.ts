/** What a list block (`StatGroup`, `KeyValueList`, `NavCardGrid`, …) reads from its route. */
export interface ItemsPayload<T> {
  items: T[];
}

/** What a source table reads from its route. */
export interface RowsPayload<T> {
  results: T[];
  total: number;
}
