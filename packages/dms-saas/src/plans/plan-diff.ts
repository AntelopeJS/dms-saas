import type {
  Feature,
  FeatureValueType,
  PlanFeatureValue,
  PlanMigrationFeatureDiff,
} from "../db";
import { PLAN_UNLIMITED } from "../db";
import { isNumber } from "../utils/primitive-guards";

/** How a value reads moving from one plan to another. */
export type PlanChangeKind = "lost" | "gained" | "changed" | "same";

/** One feature compared between two plans. */
export interface FeatureChange {
  featureId: string;
  from: unknown;
  to: unknown;
  kind: PlanChangeKind;
}

/** The feature fields a comparison reads. */
export type ComparedFeature = Pick<Feature, "_id" | "valueType">;

type Rank = (entry: PlanFeatureValue | undefined) => number;

const NO_RANK = 0;

function booleanRank(entry: PlanFeatureValue | undefined): number {
  return entry?.value === true ? 1 : NO_RANK;
}

/** Off and missing rank lowest, unlimited highest, a limit in between. */
function capRank(cap: number): number {
  if (cap === PLAN_UNLIMITED) return Number.POSITIVE_INFINITY;
  return cap > 0 ? cap : NO_RANK;
}

function numberRank(entry: PlanFeatureValue | undefined): number {
  const value = entry?.value;
  return isNumber(value) ? capRank(value) : NO_RANK;
}

const RANKS: Partial<Record<FeatureValueType, Rank>> = {
  boolean: booleanRank,
  number: numberRank,
};

/**
 * Compares two ranks: a lower one is lost, a higher one gained.
 *
 * @param from Rank on the plan left
 * @param to Rank on the plan joined
 */
export function changeKind(from: number, to: number): PlanChangeKind {
  if (to < from) return "lost";
  if (to > from) return "gained";
  return "same";
}

function textKind(
  from: PlanFeatureValue | undefined,
  to: PlanFeatureValue | undefined,
): PlanChangeKind {
  return (from?.value ?? "") === (to?.value ?? "") ? "same" : "changed";
}

function compareFeature(
  feature: ComparedFeature,
  from: PlanFeatureValue | undefined,
  to: PlanFeatureValue | undefined,
): PlanChangeKind {
  const rank = RANKS[feature.valueType];
  return rank ? changeKind(rank(from), rank(to)) : textKind(from, to);
}

function valueMap(values: PlanFeatureValue[]): Map<string, PlanFeatureValue> {
  return new Map(values.map((entry) => [entry.featureId, entry]));
}

/**
 * What changes, feature by feature, for a workspace moving between two plans
 * (both resolved with their parents): lost, gained, changed (a text) or the
 * same, in the catalogue's order.
 *
 * @param catalogue Features of the catalogue, in order
 * @param from Resolved feature values of the plan left
 * @param to Resolved feature values of the plan joined
 */
export function diffPlanFeatures(
  catalogue: ComparedFeature[],
  from: PlanFeatureValue[],
  to: PlanFeatureValue[],
): FeatureChange[] {
  const fromValues = valueMap(from);
  const toValues = valueMap(to);
  return catalogue.map((feature) => {
    const before = fromValues.get(feature._id);
    const after = toValues.get(feature._id);
    return {
      featureId: feature._id,
      from: before?.value ?? null,
      to: after?.value ?? null,
      kind: compareFeature(feature, before, after),
    };
  });
}

/**
 * How a member cap changes: `-1` is unlimited.
 *
 * @param from Cap of the plan left
 * @param to Cap of the plan joined
 */
export function memberCapChange(from: number, to: number): PlanChangeKind {
  return changeKind(capRank(from), capRank(to));
}

function isAbsentFeature(change: FeatureChange, side: "from" | "to"): boolean {
  const value = change[side];
  return value === null || value === false;
}

/**
 * What a migration records of a feature comparison: the features the target
 * plan adds, the ones it drops, and the ones it sets differently.
 *
 * @param changes Every feature compared, from `diffPlanFeatures`
 */
export function migrationFeatureDiff(
  changes: FeatureChange[],
): PlanMigrationFeatureDiff {
  const moved = changes.filter((change) => change.kind !== "same");
  const keysWhere = (test: (change: FeatureChange) => boolean) =>
    moved.filter(test).map((change) => change.featureId);
  return {
    added: keysWhere(
      (change) =>
        isAbsentFeature(change, "from") && !isAbsentFeature(change, "to"),
    ),
    removed: keysWhere(
      (change) =>
        !isAbsentFeature(change, "from") && isAbsentFeature(change, "to"),
    ),
    changed: moved
      .filter(
        (change) =>
          isAbsentFeature(change, "from") === isAbsentFeature(change, "to"),
      )
      .map((change) => ({
        key: change.featureId,
        oldValue: change.from,
        newValue: change.to,
      })),
  };
}
