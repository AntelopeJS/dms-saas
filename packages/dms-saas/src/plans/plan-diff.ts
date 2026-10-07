import type { Feature, PlanFeatureValue } from "../db";
import { FEATURE_UNLIMITED_VALUE } from "./plan-write";

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

type Rank = (value: unknown) => number;

const NO_RANK = 0;

function booleanRank(value: unknown): number {
  return value === true ? 1 : NO_RANK;
}

/** Off and missing rank lowest, unlimited highest, a limit in between. */
function numberRank(value: unknown): number {
  if (value === FEATURE_UNLIMITED_VALUE) return Number.POSITIVE_INFINITY;
  return typeof value === "number" && value > 0 ? value : NO_RANK;
}

const RANKS: Record<string, Rank> = {
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

function textKind(from: unknown, to: unknown): PlanChangeKind {
  return (from ?? "") === (to ?? "") ? "same" : "changed";
}

function compareFeature(
  feature: ComparedFeature,
  from: unknown,
  to: unknown,
): PlanChangeKind {
  const rank = RANKS[feature.valueType];
  return rank ? changeKind(rank(from), rank(to)) : textKind(from, to);
}

function valueMap(values: PlanFeatureValue[]): Map<string, unknown> {
  return new Map(values.map((entry) => [entry.featureId, entry.value]));
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
      from: before ?? null,
      to: after ?? null,
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
  return changeKind(numberRank(from), numberRank(to));
}
