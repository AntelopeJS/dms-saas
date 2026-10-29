import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  DEFAULT_STRIPE_TAX_CODE,
  type Plan,
  PlanModel,
  type PlanProviderRefs,
} from "../../src/db";
import { toMinorUnits } from "../../src/utils/money";
import { planRow } from "./plan-row";

const OFF_STRIPE: PlanProviderRefs = {};

/** What a plan row holds unless a test says otherwise: a flat monthly plan on sale to anyone. */
const PLAN_DEFAULTS = {
  audience: "any",
  price: 0,
  currency: "eur",
  interval: "month",
  billingMode: "flat",
  trialDays: 0,
  maxMembers: -1,
  isActive: true,
  isDeleted: false,
  paymentProviderRefs: OFF_STRIPE,
} satisfies Partial<Plan>;

/**
 * Stores a plan whose Stripe price, when it has one, is already in line with
 * its terms, the state a synced plan is read in: selling it asks Stripe
 * nothing. A plan given no `stripePriceId` stays off Stripe.
 *
 * @param fields The plan's fields over {@link PLAN_DEFAULTS}; `name` defaults to the id
 */
export async function insertPlan(
  fields: Partial<Plan> & Pick<Plan, "_id">,
): Promise<Plan> {
  const merged = {
    ...PLAN_DEFAULTS,
    slug: fields._id,
    name: fields._id,
    ...fields,
  };
  const { stripePriceId } = merged.paymentProviderRefs;
  const paymentProviderRefs = stripePriceId
    ? {
        stripeProductId: `prod_${merged._id}`,
        stripePriceId,
        stripeSyncedTerms: {
          product: {
            name: merged.name,
            description: merged.description ?? "",
            taxCode: DEFAULT_STRIPE_TAX_CODE,
          },
          price: {
            unitAmount: toMinorUnits(merged.price, merged.currency),
            currency: merged.currency.toLowerCase(),
            interval: merged.interval,
            billingMode: merged.billingMode,
          },
        },
      }
    : merged.paymentProviderRefs;
  const model = GetModel(PlanModel);
  await model.insert(planRow({ ...merged, paymentProviderRefs }));
  const stored = await model.get(merged._id);
  if (!stored) throw new Error(`Plan ${merged._id} was not stored`);
  return stored;
}
