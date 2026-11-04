/**
 * Whether a value is a non-null object, whose fields a test then reads one by
 * one, each still unchecked.
 *
 * @param value A value read from a payload or a stand-in
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
