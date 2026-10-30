import { expect } from "vitest";

/**
 * Vitest types its asymmetric matchers `any`, which makes every object
 * literal holding one an untyped value. These are typed as what an
 * expectation needs of them: an opaque value that `toEqual` and `toMatchObject`
 * check against the received one.
 */

/** Matches any string. */
export const ANY_STRING: unknown = expect.any(String);

/** Matches any date. */
export const ANY_DATE: unknown = expect.any(Date);
