/** The value a test looked up; throws when the lookup found nothing. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be defined`);
  }
  return value;
}
