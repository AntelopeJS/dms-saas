/**
 * Whether a value is a string primitive.
 *
 * @param value The value to test
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Whether a value is a number primitive (NaN and the infinities included).
 *
 * @param value The value to test
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/**
 * Whether a value is a boolean primitive.
 *
 * @param value The value to test
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Whether a value is an object or `null`, as `typeof` reports it.
 *
 * @param value The value to test
 */
export function isObjectOrNull(value: unknown): value is object | null {
  return typeof value === "object";
}
