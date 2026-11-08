import {
  type Constructible,
  DatumStaticMetadata,
  type DeepPartial,
  getMetadata,
} from "@antelopejs/interface-database-decorators";

/** Reports whether a field may hold `value`. */
export type FieldGuard = (value: unknown) => value is unknown;

type FieldType = DatumStaticMetadata["fields"][string];

const UNCHECKED_TYPE_NAME = "any";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

const TYPE_NAME_GUARDS = new Map<string, FieldGuard>([
  ["string", isString],
  ["number", isNumber],
  ["boolean", isBoolean],
  ["date", isDate],
]);

function isTypeName(type: FieldType | undefined): type is string {
  return typeof type === "string";
}

/**
 * Reports whether each field `patch` sets holds a value of the type name it
 * is declared with (`@Field("string")`), which a model's `validate` skips, and
 * passes the guard `refinements` holds for it. A type name records no
 * nullability, so `null` passes it; an unknown type name fails. Fields
 * declared with a codec are left to `validate`.
 *
 * @internal
 */
export function matchesDeclaredTypes<T extends object>(
  table: Constructible<T>,
  patch: DeepPartial<T>,
  refinements: Readonly<Record<string, FieldGuard>> = {},
): boolean {
  const { fields } = getMetadata(table, DatumStaticMetadata);
  return Object.entries(patch).every(([field, value]) => {
    if (value === undefined) return true;
    if (Object.hasOwn(refinements, field) && !refinements[field](value))
      return false;
    const type = Object.hasOwn(fields, field) ? fields[field] : undefined;
    if (!isTypeName(type) || type === UNCHECKED_TYPE_NAME || value === null)
      return true;
    return TYPE_NAME_GUARDS.get(type)?.(value) ?? false;
  });
}
