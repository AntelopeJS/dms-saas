import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  DEFAULT_STRIPE_TAX_CODE,
  type Feature,
  FeatureModel,
  type PlanProviderRefs,
  PlanModel,
} from "@antelopejs/interface-dms-saas/db";
import {
  GetPermissions,
  type PermissionTree,
} from "@antelopejs/interface-dms/permissions";
import { PLANS } from "../data/catalogue";
import type { LocalizedText, SeedFeature, SeedPlan } from "../data/types";
import { dayFrom, insertMissing, type SeedRow } from "./rows";

/** Every locale of a localized field is written at once. */
const ALL_LOCALES = "*";
/** Stripe prices are in minor units, plan prices in major ones. */
const MINOR_UNITS_PER_MAJOR = 100;
const PLAN_CATALOGUE_CREATED_ON = -700;

function collectPermissionIds(tree: Record<string, PermissionTree>): string[] {
  return Object.values(tree).flatMap((node) => [
    ...(node.data ? [node.data.id] : []),
    ...collectPermissionIds(node.children),
  ]);
}

/** Every permission the DMS can grant now: pages, blocks and actions. */
export async function readGrantablePermissions(): Promise<string[]> {
  return [...new Set(collectPermissionIds(await GetPermissions()))];
}

// A feature without a tooltip holds one empty text per language, as the DMS
// form writes it: the data API cannot localize a null.
const NO_TOOLTIP: LocalizedText = { en: "", fr: "" };

function toFeatureRow(feature: SeedFeature): SeedRow {
  const { id, ...fields } = feature;
  return { ...fields, tooltip: fields.tooltip ?? NO_TOOLTIP, _id: id };
}

function localizeAll(feature: Feature): Feature {
  return feature.localize(ALL_LOCALES);
}

/**
 * Fake Stripe ids, with the terms dms-saas records after a sync: the plan
 * reads as in line with Stripe, so no Stripe call is ever made for it, even
 * with real keys configured.
 */
function fakeStripeRefs(plan: SeedPlan): PlanProviderRefs {
  if (!plan.stripeKey) return {};
  return {
    stripeProductId: `prod_${plan.stripeKey}`,
    stripePriceId: `price_1${plan.stripeKey}`,
    stripeSyncedTerms: {
      product: {
        name: plan.name,
        description: plan.description,
        taxCode: DEFAULT_STRIPE_TAX_CODE,
      },
      price: {
        unitAmount: Math.round(plan.price * MINOR_UNITS_PER_MAJOR),
        currency: plan.currency.toLowerCase(),
        interval: plan.interval,
        billingMode: plan.billingMode,
      },
    },
  };
}

function toPlanRow(plan: SeedPlan, permissions: string[]): SeedRow {
  const { id, stripeKey: _stripeKey, features, ...fields } = plan;
  return {
    ...fields,
    _id: id,
    slug: id,
    features: Object.entries(features).map(([featureId, value]) => ({
      featureId,
      value,
    })),
    // Inherited plans hold only what they add.
    permissions: plan.inheritsFromPlanId ? [] : permissions,
    paymentProviderRefs: fakeStripeRefs(plan),
    borderColor: null,
    isDeleted: false,
    createdAt: dayFrom(PLAN_CATALOGUE_CREATED_ON),
  };
}

export async function writeCatalogue(
  features: SeedFeature[],
  plans: SeedPlan[],
): Promise<void> {
  await insertMissing(
    FeatureModel,
    features.map(toFeatureRow),
    undefined,
    localizeAll,
  );
  const permissions = await readGrantablePermissions();
  await insertMissing(
    PlanModel,
    plans.map((plan) => toPlanRow(plan, permissions)),
  );
}

/**
 * Adds to the seeded plans the permissions registered since they were
 * written, so a page added to the module is not hidden from every workspace
 * owner by a stale catalogue. Never removes one an operator granted.
 */
export async function grantNewPermissionsToSeededPlans(): Promise<void> {
  const model = GetModel(PlanModel);
  const grantable = await readGrantablePermissions();
  for (const seeded of PLANS.filter((plan) => !plan.inheritsFromPlanId)) {
    const plan = await model.get(seeded.id);
    if (!plan) continue;
    const missing = grantable.filter((id) => !plan.permissions.includes(id));
    if (missing.length === 0) continue;
    await model.update(plan._id, {
      permissions: [...plan.permissions, ...missing],
    });
  }
}
