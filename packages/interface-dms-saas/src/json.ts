/** A value of a JSON document, as a request body or a stored document carries it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON object: string keys, JSON values. */
export type JsonObject = { [key: string]: JsonValue };
