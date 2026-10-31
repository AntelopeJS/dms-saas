import {
  type Plan,
  PLAN_FALLBACK_LOCALE,
  PLAN_LOCALIZED_FIELDS,
  PlanModel,
} from "../../src/db";
import { isString } from "../../src/utils/primitive-guards";

/**
 * A plan as `PlanModel` reads it, from fields whose texts are written in the
 * fallback locale: each text is stored as one value per locale, then read
 * back in that locale. A text left `null` is left out, as dms-saas writes it.
 */
export function planRow(fields: Partial<Plan>): Plan {
  const kept = { ...fields };
  for (const field of PLAN_LOCALIZED_FIELDS) {
    if (fields[field] == null) delete kept[field];
  }
  const texts = PLAN_LOCALIZED_FIELDS.flatMap(
    (field): [string, Record<string, string>][] => {
      const text = fields[field];
      return isString(text) ? [[field, { [PLAN_FALLBACK_LOCALE]: text }]] : [];
    },
  );
  return PlanModel.fromPlainData({ ...kept, ...Object.fromEntries(texts) })
    .localize("*", PLAN_LOCALIZED_FIELDS)
    .localize(PLAN_FALLBACK_LOCALE, PLAN_LOCALIZED_FIELDS);
}
