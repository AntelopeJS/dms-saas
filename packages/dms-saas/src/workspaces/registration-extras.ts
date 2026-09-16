import { assert } from "@antelopejs/interface-api-util";
import { REGISTRATION_EXTRAS_LIMITS } from "@antelopejs/interface-dms-saas/registration";

const HTTP_BAD_REQUEST = 400;

/**
 * Registration is public and unauthenticated, and `extras` is forwarded to
 * third-party listeners without ever being read: it has to be bounded before
 * it becomes anyone else's problem. The limits are sized for what a signup
 * form can legitimately capture — a few dozen short answers — which leaves
 * every one of them far below the point where this endpoint would be worth
 * abusing as storage or as an amplifier.
 */
const MAX_SERIALISED_BYTES = REGISTRATION_EXTRAS_LIMITS.maxSerialisedBytes;
const MAX_KEYS = REGISTRATION_EXTRAS_LIMITS.maxKeys;
const MAX_DEPTH = REGISTRATION_EXTRAS_LIMITS.maxDepth;

/** Never a form field, always an attempt at the object prototype. */
const FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];

const INVALID_ERROR = "saas.errors.registration.extras_invalid";
const TOO_LARGE_ERROR = "saas.errors.registration.extras_too_large";
const TOO_COMPLEX_ERROR = "saas.errors.registration.extras_too_complex";

interface ExtrasShape {
  keys: number;
  depth: number;
  hasForbiddenKey: boolean;
}

const EMPTY_SHAPE: ExtrasShape = { keys: 0, depth: 0, hasForbiddenKey: false };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeShapes(left: ExtrasShape, right: ExtrasShape): ExtrasShape {
  return {
    keys: left.keys + right.keys,
    depth: Math.max(left.depth, right.depth),
    hasForbiddenKey: left.hasForbiddenKey || right.hasForbiddenKey,
  };
}

/** One walk for every limit: the payload is untrusted, so it is read once. */
function inspect(value: unknown, depth: number): ExtrasShape {
  if (Array.isArray(value)) {
    return value
      .map((entry) => inspect(entry, depth + 1))
      .reduce(mergeShapes, { ...EMPTY_SHAPE, depth });
  }
  // A leaf adds no level of its own: `{ a: 1 }` is one deep, not two.
  if (!isPlainObject(value)) return EMPTY_SHAPE;
  return Object.entries(value)
    .map(([key, nested]) =>
      mergeShapes(inspect(nested, depth + 1), {
        keys: 1,
        depth,
        hasForbiddenKey: FORBIDDEN_KEYS.includes(key),
      }),
    )
    .reduce(mergeShapes, { ...EMPTY_SHAPE, depth });
}

/**
 * Reject an `extras` payload the module would otherwise hand on unbounded.
 *
 * Shape only: what the keys mean belongs to the consumer, so nothing here
 * looks at values beyond how much of them there is. Size is checked first —
 * it is the cheap gate that bounds the walk behind it.
 *
 * @param extras Consumer-supplied capture, absent on most registrations
 * @throws 400 when it is not a plain object or exceeds one of the limits
 */
export function assertRegistrationExtras(extras: unknown): void {
  if (extras === undefined || extras === null) return;
  assert(isPlainObject(extras), HTTP_BAD_REQUEST, INVALID_ERROR);
  assert(
    Buffer.byteLength(JSON.stringify(extras), "utf8") <= MAX_SERIALISED_BYTES,
    HTTP_BAD_REQUEST,
    TOO_LARGE_ERROR,
  );

  const shape = inspect(extras, 1);
  assert(!shape.hasForbiddenKey, HTTP_BAD_REQUEST, INVALID_ERROR);
  assert(
    shape.keys <= MAX_KEYS && shape.depth <= MAX_DEPTH,
    HTTP_BAD_REQUEST,
    TOO_COMPLEX_ERROR,
  );
}
