import type { Feature, Plan, PlanFeatureValue } from "../db";

/**
 * What a number feature holds (Q36): `0` turns it off, `-1` makes it
 * unlimited, and any whole number from 1 is a limit.
 */
export const FEATURE_OFF_VALUE = 0;
export const FEATURE_UNLIMITED_VALUE = -1;

const MIN_LIMIT = 1;
const SLUG_MAX_LENGTH = 100;
const COMBINING_MARKS = /[̀-ͯ]/g;
const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/**
 * The access part of a plan as its editor reads and writes it: the parent it
 * follows live, and its own permissions and feature values. A feature absent
 * from `extraFeatures` is inherited from the parent; one present overrides it.
 */
export interface PlanInheritanceInput {
  parentPlanId: string | null;
  extraPermissions: string[];
  extraFeatures: Record<string, unknown>;
}

export const PLAN_WRITE_FIELDS = [
  "name",
  "slug",
  "description",
  "audience",
  "price",
  "currency",
  "interval",
  "billingMode",
  "features",
  "permissions",
  "inheritsFromPlanId",
  "trialDays",
  "maxMembers",
  "isPublic",
  "borderColor",
  "borderLabel",
  "order",
  "isActive",
] as const satisfies readonly (keyof Plan)[];

/** A plan write as the editor and the API send it. */
export type PlanWriteBody = Partial<
  Pick<Plan, (typeof PLAN_WRITE_FIELDS)[number]>
> & {
  inheritance?: PlanInheritanceInput | string | null;
};

function parseInheritance(
  raw: PlanInheritanceInput | string | null,
): PlanInheritanceInput | null {
  if (typeof raw !== "string") return raw;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlanInheritanceInput;
  } catch {
    return null;
  }
}

function withoutInheritance(body: PlanWriteBody): PlanWriteBody {
  const rest = { ...body };
  delete rest.inheritance;
  return rest;
}

/** The plan fields the `inheritance` value of the editor stands for. */
export function expandInheritance(body: PlanWriteBody): PlanWriteBody {
  if (body.inheritance === undefined) return body;
  const parsed = parseInheritance(body.inheritance);
  if (!parsed) return withoutInheritance(body);
  return {
    ...withoutInheritance(body),
    inheritsFromPlanId: parsed.parentPlanId ?? null,
    permissions: parsed.extraPermissions ?? [],
    features: Object.entries(parsed.extraFeatures ?? {}).map(
      ([featureId, value]) => ({ featureId, value }),
    ),
  };
}

/** A plan's own access, as the editor reads it. */
export function toInheritance(plan: Plan): PlanInheritanceInput {
  return {
    parentPlanId: plan.inheritsFromPlanId ?? null,
    extraPermissions: plan.permissions ?? [],
    extraFeatures: Object.fromEntries(
      (plan.features ?? []).map((feature) => [
        feature.featureId,
        feature.value,
      ]),
    ),
  };
}

/** Keeps the writable plan fields of a body, `inheritance` expanded. */
export function pickPlanWrite(body: PlanWriteBody): Partial<Plan> {
  const expanded = expandInheritance(body);
  const out: Partial<Plan> = {};
  for (const field of PLAN_WRITE_FIELDS) {
    if (expanded[field] !== undefined) {
      Object.assign(out, { [field]: expanded[field] });
    }
  }
  return out;
}

/** A URL-safe slug from a plan name: `Growth 2024` → `growth-2024`. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(NON_SLUG_CHARACTERS, "-")
    .replace(EDGE_DASHES, "")
    .slice(0, SLUG_MAX_LENGTH);
}

function isNumberFeatureValue(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (value >= MIN_LIMIT ||
      value === FEATURE_OFF_VALUE ||
      value === FEATURE_UNLIMITED_VALUE)
  );
}

const FEATURE_VALUE_CHECKS: Record<string, (value: unknown) => boolean> = {
  boolean: (value) => typeof value === "boolean",
  number: isNumberFeatureValue,
  string: (value) => typeof value === "string",
};

/**
 * The feature values a plan cannot store: an unknown feature, or a value
 * that does not fit its feature's type (a number feature takes `0` for off,
 * `-1` for unlimited or a whole limit from 1).
 *
 * @param values Feature values a plan write carries
 * @param catalogue Features of the catalogue
 * @returns Ids of the refused features, empty when all fit
 */
export function invalidFeatureValues(
  values: PlanFeatureValue[],
  catalogue: Pick<Feature, "_id" | "valueType">[],
): string[] {
  const types = new Map(
    catalogue.map((feature) => [feature._id, feature.valueType]),
  );
  return values
    .filter((entry) => {
      const check = FEATURE_VALUE_CHECKS[types.get(entry.featureId) ?? ""];
      return !check?.(entry.value);
    })
    .map((entry) => entry.featureId);
}

/** Whether a member cap is unlimited (`-1`) or a whole number of seats from 1. */
export function isValidMemberCap(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (value >= MIN_LIMIT || value === FEATURE_UNLIMITED_VALUE)
  );
}
