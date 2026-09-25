import type {
  Feature,
  FeatureModel,
  FeatureValueType,
  Plan,
  PlanInterval,
  PlanModel,
} from "./db";
import { FEATURE_DEFAULT_ORDER } from "./db";

const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  month: 1,
  year: 12,
};

/** Display metadata for one feature in a tenant plan comparison. */
export interface TenantPlanFeature {
  featureId: string;
  displayName: string;
  tooltip: string | null;
  unit: string | null;
  valueType: FeatureValueType;
  isDetailRow: boolean;
  order: number;
}

/** Customer-facing projection of a plan and its resolved feature values. */
export interface TenantPlanView {
  _id: string;
  name: string;
  price: number;
  currency: string;
  interval: PlanInterval;
  order: number;
  /**
   * Sold on quote: shown with a contact link, never selectable. Always set by
   * dms-saas; optional so views built before the flag existed still type.
   */
  isContactOnly?: boolean;
  checkoutAvailable: boolean;
  featureValues: Record<string, unknown>;
}

/** Comparison payload containing ordered plans and their feature catalogue. */
export interface TenantPlanCatalog {
  plans: TenantPlanView[];
  features: TenantPlanFeature[];
}

/** Normalize a recurring plan price to its monthly amount. */
export function monthlyPrice(plan: Plan): number {
  return plan.price / MONTHS_PER_INTERVAL[plan.interval];
}

/**
 * A plan change is a downgrade when the customer ends up paying us less per
 * month. Equal prices are treated as an upgrade so the change applies at once.
 */
export function isDowngrade(current: Plan | null, target: Plan): boolean {
  if (!current) return false;
  return monthlyPrice(target) < monthlyPrice(current);
}

function toPlanFeature(feature: Feature): TenantPlanFeature {
  return {
    featureId: feature._id,
    displayName: feature.displayName,
    tooltip: feature.tooltip ?? null,
    unit: feature.unit ?? null,
    valueType: feature.valueType,
    isDetailRow: !!feature.isDetailRow,
    order: feature.order ?? FEATURE_DEFAULT_ORDER,
  };
}

async function toPlanView(
  planModel: PlanModel,
  plan: Plan,
  knownFeatureIds: Set<string>,
): Promise<TenantPlanView> {
  const resolved = await planModel.resolveInheritance(plan);
  const featureValues: Record<string, unknown> = {};
  for (const entry of resolved.features) {
    if (!knownFeatureIds.has(entry.featureId)) continue;
    featureValues[entry.featureId] = entry.value;
  }
  return {
    _id: plan._id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    order: plan.order,
    isContactOnly: !!plan.isContactOnly,
    checkoutAvailable:
      !plan.isContactOnly && !!plan.paymentProviderRefs?.stripePriceId,
    featureValues,
  };
}

/**
 * Comparison-table payload: one column per plan with its inherited feature
 * values already resolved, and the feature catalogue carrying the display
 * metadata the table renders rows from.
 */
export async function buildTenantPlanCatalog(
  planModel: PlanModel,
  featureModel: FeatureModel,
  plans: Plan[],
): Promise<TenantPlanCatalog> {
  const features = await featureModel.getAll();
  const knownFeatureIds = new Set(features.map((feature) => feature._id));
  const views = await Promise.all(
    plans.map((plan) => toPlanView(planModel, plan, knownFeatureIds)),
  );
  return {
    plans: views.sort((left, right) => left.order - right.order),
    features: features
      .map(toPlanFeature)
      .sort((left, right) => left.order - right.order),
  };
}
