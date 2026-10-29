import {
  GetModel,
  toPlainData,
} from "@antelopejs/interface-database-decorators";
import {
  type Plan,
  PLAN_FALLBACK_LOCALE,
  PLAN_LOCALIZED_FIELDS,
  PlanModel,
} from "../../src/db";

/**
 * Stores a plan as `planRow` builds it, read in the fallback locale: its name
 * and description are written as one value per locale, so reading the row
 * back gives the same texts. Inserting the plan itself would store no texts.
 *
 * @param plan A plan built by `planRow`
 */
export async function insertPlan(plan: Plan): Promise<void> {
  await GetModel(PlanModel).insert(
    PlanModel.fromPlainData({
      ...toPlainData(plan),
      name: { [PLAN_FALLBACK_LOCALE]: plan.name },
      description: { [PLAN_FALLBACK_LOCALE]: plan.description },
    }).localize("*", PLAN_LOCALIZED_FIELDS),
  );
}
