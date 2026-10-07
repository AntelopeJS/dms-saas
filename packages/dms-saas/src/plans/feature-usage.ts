import type { Plan } from "../db";

/** Plans storing a value for each feature, by feature id. */
export type FeatureUsage = Map<string, string[]>;

/**
 * Which plans store a value of their own for each feature (a value only
 * inherited from a parent is the parent's). Deleted plans store nothing.
 *
 * @param plans Plans of the catalogue
 */
export function featureUsage(
  plans: Pick<Plan, "_id" | "features" | "isDeleted">[],
): FeatureUsage {
  const usage: FeatureUsage = new Map();
  for (const plan of plans) {
    if (plan.isDeleted) continue;
    for (const entry of plan.features ?? []) {
      usage.set(entry.featureId, [
        ...(usage.get(entry.featureId) ?? []),
        plan._id,
      ]);
    }
  }
  return usage;
}

/** The plans storing a value of their own for one feature. */
export function plansUsingFeature(
  plans: Pick<Plan, "_id" | "features" | "isDeleted">[],
  featureId: string,
): string[] {
  return featureUsage(plans).get(featureId) ?? [];
}
