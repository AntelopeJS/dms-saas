/**
 * The fields of a table row as a plain object: it spreads like data, where an
 * instance of the table class would lose its prototype.
 */
export type RowFields<Row> = { [Field in keyof Row]: Row[Field] };
