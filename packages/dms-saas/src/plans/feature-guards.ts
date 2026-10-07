import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { PlanModel } from "../db";
import { featureUsage, plansUsingFeature } from "./feature-usage";

const HTTP_CONFLICT = 409;
const VALUE_TYPE_FIELD = "valueType";
const VALUE_TYPE_LOCKED = "$saas.errors.feature.value_type_locked";
const FEATURE_IN_USE = "$saas.errors.feature.in_use";

/** The fields of a feature write a guard compares. */
export interface FeatureTypeWrite {
  valueType?: unknown;
}

/**
 * Refuses to change the value type of a feature plans store a value for:
 * their values would no longer read (a number turned into on/off).
 *
 * @param featureId Feature edited
 * @param body Fields the edit writes
 * @param current Feature as stored
 * @throws HTTPResult 409 naming the value type field
 */
export async function assertValueTypeKept(
  featureId: string,
  body: FeatureTypeWrite,
  current: FeatureTypeWrite,
): Promise<void> {
  if (body.valueType === undefined || body.valueType === current.valueType) {
    return;
  }
  const plans = await GetModel(PlanModel).findNotDeleted();
  if (plansUsingFeature(plans, featureId).length === 0) return;
  throw new HTTPResult(HTTP_CONFLICT, {
    message: VALUE_TYPE_LOCKED,
    field: VALUE_TYPE_FIELD,
  });
}

/**
 * Refuses to delete a feature plans still store a value for: switch it off
 * on each plan first.
 *
 * @param featureIds Features deleted
 * @throws HTTPResult 409 when one is in use
 */
export async function assertFeaturesUnused(
  featureIds: string[],
): Promise<void> {
  const usage = featureUsage(await GetModel(PlanModel).findNotDeleted());
  const isInUse = featureIds.some((id) => (usage.get(id)?.length ?? 0) > 0);
  if (isInUse) throw new HTTPResult(HTTP_CONFLICT, FEATURE_IN_USE);
}
