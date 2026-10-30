import type {
  Feature,
  FeatureValueType,
  Plan,
  PlanFeatureValue,
  PlanLocalizedText,
} from "../db";
import { withPermissionAncestors } from "./plan-permission-tree";
import { PLAN_LOCALIZED_FIELDS, PLAN_UNLIMITED, PlanModel } from "../db";
import type { JsonValue } from "../utils/json-value";
import { isBoolean, isNumber, isString } from "../utils/primitive-guards";

/**
 * What a number feature holds: `0` turns it off, `-1` makes it
 * unlimited, and any whole number from 1 is a limit.
 */
export const FEATURE_OFF_VALUE = 0;

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

/** A free text trimmed, in each of its locales when it is localized. */
function trimmed(
  value: string | PlanLocalizedText,
): string | PlanLocalizedText {
  if (isString(value)) return value.trim();
  return Object.fromEntries(
    Object.entries(value).map(([locale, text]) => [locale, text.trim()]),
  );
}

/** Free-text fields stored trimmed: they are shown and sent to Stripe as is. */
const TRIMMED_FIELDS = [
  "name",
  "slug",
  "description",
  "borderLabel",
] as const satisfies readonly (keyof Plan)[];

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

/** The plan texts the operator writes once per locale. */
type PlanTextField = "name" | "description" | "borderLabel";

/**
 * A plan's texts with one value per locale, as the editor reads and writes
 * them. A text is never `null`: a localized field cannot be read back from
 * one, so an empty text holds empty values (`{ en: "" }`) or is left out.
 */
export type PlanTexts = Partial<Record<PlanTextField, PlanLocalizedText>>;

/** A plan write: its fields, texts written one value per locale. */
export type PlanWrite = Omit<Partial<Plan>, PlanTextField> & PlanTexts;

/** A plan write as the editor and the API send it. */
export type PlanWriteBody = Omit<
  Partial<Pick<Plan, (typeof PLAN_WRITE_FIELDS)[number]>>,
  PlanTextField
> &
  PlanTexts & {
    inheritance?: PlanInheritanceInput | null;
  };

function withoutInheritance(body: PlanWriteBody): PlanWriteBody {
  const rest = { ...body };
  delete rest.inheritance;
  return rest;
}

/** The plan fields the `inheritance` value of the editor stands for. */
export function expandInheritance(body: PlanWriteBody): PlanWriteBody {
  const { inheritance } = body;
  if (!inheritance) return withoutInheritance(body);
  return {
    ...withoutInheritance(body),
    inheritsFromPlanId: inheritance.parentPlanId,
    permissions: inheritance.extraPermissions,
    features: Object.entries(inheritance.extraFeatures).map(
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

/**
 * Keeps the writable plan fields of a body, `inheritance` expanded, its
 * free-text fields trimmed and its permissions completed with the ids they
 * sit under.
 */
export function pickPlanWrite(body: PlanWriteBody): PlanWrite {
  const expanded = expandInheritance(body);
  const out: PlanWrite = {};
  for (const field of PLAN_WRITE_FIELDS) {
    const isText = PLAN_LOCALIZED_FIELDS.some((text) => text === field);
    if (isText ? expanded[field] != null : expanded[field] !== undefined) {
      Object.assign(out, { [field]: expanded[field] });
    }
  }
  for (const field of TRIMMED_FIELDS) {
    const value = out[field];
    if (value) Object.assign(out, { [field]: trimmed(value) });
  }
  if (out.permissions)
    out.permissions = withPermissionAncestors(out.permissions);
  return out;
}

/**
 * A plan's texts with one value per locale. Leaves the plan unlocked in every
 * locale (`localize("*")`): read it again with `localizePlan()` to get one.
 */
export function planTexts(plan: Plan): PlanTexts {
  plan.localize("*", PLAN_LOCALIZED_FIELDS);
  return Object.fromEntries(
    PLAN_LOCALIZED_FIELDS.map((field) => [field, plan[field]]).filter(
      ([, text]) => text != null,
    ),
  ) as PlanTexts;
}

/** The plan row a write stores, its texts locked one value per locale. */
export function toPlanRow(write: PlanWrite): Plan {
  return PlanModel.fromPlainData(write).localize("*", PLAN_LOCALIZED_FIELDS);
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
    isNumber(value) &&
    Number.isInteger(value) &&
    (value >= MIN_LIMIT ||
      value === FEATURE_OFF_VALUE ||
      value === PLAN_UNLIMITED)
  );
}

const FEATURE_VALUE_CHECKS: Partial<
  Record<FeatureValueType, (value: unknown) => boolean>
> = {
  boolean: (value) => isBoolean(value),
  number: isNumberFeatureValue,
  string: (value) => isString(value),
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
      const valueType = types.get(entry.featureId);
      const check =
        valueType === undefined ? undefined : FEATURE_VALUE_CHECKS[valueType];
      return !check?.(entry.value);
    })
    .map((entry) => entry.featureId);
}

/** Whether a member cap is unlimited (`-1`) or a whole number of seats from 1. */
export function isValidMemberCap(value: JsonValue | undefined): boolean {
  return (
    isNumber(value) &&
    Number.isInteger(value) &&
    (value >= MIN_LIMIT || value === PLAN_UNLIMITED)
  );
}
