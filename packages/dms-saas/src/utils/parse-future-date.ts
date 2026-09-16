import { assert } from "@antelopejs/interface-api-util";

const HTTP_BAD_REQUEST = 400;

/**
 * Parses an optional future date. Returns null only when no value is provided
 * (meaning "no expiry"); a value that is actually supplied but malformed or in
 * the past is rejected with a 400 — so a corrupt or stale date is never
 * silently coerced into unlimited access.
 */
export function parseFutureDate(value: unknown, errorKey: string): Date | null {
  if (value === null || value === undefined || value === "") return null;
  assert(
    typeof value === "string" || value instanceof Date,
    HTTP_BAD_REQUEST,
    errorKey,
  );
  const parsed = value instanceof Date ? value : new Date(value);
  assert(!Number.isNaN(parsed.getTime()), HTTP_BAD_REQUEST, errorKey);
  assert(parsed.getTime() > Date.now(), HTTP_BAD_REQUEST, errorKey);
  return parsed;
}
