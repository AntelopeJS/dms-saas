import { GetModel } from "@antelopejs/interface-database-decorators";
import type Stripe from "stripe";
import type { Plan, PlanProviderRefs } from "../db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_STRIPE_TAX_CODE,
} from "../db";
import { getStripeClient } from "./client";

const PRICE_MULTIPLIER = 100;
const SEAT_USAGE_TYPE = "licensed" as const;
const PRICE_TAX_BEHAVIOR = "exclusive" as const;

async function resolveProductTaxCode(): Promise<string> {
  const billingSettingsModel = GetModel(BillingSettingsModel);
  const settings = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return settings?.stripeTaxCode || DEFAULT_STRIPE_TAX_CODE;
}

function buildRecurring(plan: Plan): Stripe.PriceCreateParams.Recurring {
  const recurring: Stripe.PriceCreateParams.Recurring = {
    interval: plan.interval,
  };
  if (plan.billingMode === "seat") {
    recurring.usage_type = SEAT_USAGE_TYPE;
  }
  return recurring;
}

async function ensureProduct(
  plan: Plan,
  refs: PlanProviderRefs,
  taxCode: string,
): Promise<string> {
  const stripe = getStripeClient();
  if (!refs.stripeProductId) {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      tax_code: taxCode,
      metadata: { planId: plan._id },
    });
    return product.id;
  }
  await stripe.products.update(refs.stripeProductId, {
    name: plan.name,
    description: plan.description,
    tax_code: taxCode,
  });
  return refs.stripeProductId;
}

async function archivePreviousPrice(refs: PlanProviderRefs): Promise<void> {
  if (!refs.stripePriceId) return;
  const stripe = getStripeClient();
  await stripe.prices.update(refs.stripePriceId, { active: false });
}

export async function syncPlanWithStripe(plan: Plan): Promise<Plan> {
  const refs: PlanProviderRefs = { ...plan.paymentProviderRefs };
  const taxCode = await resolveProductTaxCode();
  const productId = await ensureProduct(plan, refs, taxCode);
  refs.stripeProductId = productId;

  const stripe = getStripeClient();
  const newPrice = await stripe.prices.create({
    product: productId,
    unit_amount: Math.round(plan.price * PRICE_MULTIPLIER),
    currency: plan.currency.toLowerCase(),
    recurring: buildRecurring(plan),
    tax_behavior: PRICE_TAX_BEHAVIOR,
    metadata: { planId: plan._id, billingMode: plan.billingMode },
  });

  await archivePreviousPrice(refs);
  refs.stripePriceId = newPrice.id;

  // The spread rows are AntelopeJS table classes: `Table` declares one
  // field and a static, no instance methods, and the result is serialised
  // to JSON on the way out. There is no prototype to lose.
  // oxlint-disable-next-line typescript/no-misused-spread
  return { ...plan, paymentProviderRefs: refs };
}
