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

const SEAT_BILLING_MODE = "seat";
const MIN_BILLED_SEATS = 1;

/** What a plan bills per month for a workspace using `seats` seats. */
function monthlyCost(plan: Plan, seats: number): number {
  const units =
    plan.billingMode === SEAT_BILLING_MODE
      ? Math.max(MIN_BILLED_SEATS, seats)
      : 1;
  return monthlyPrice(plan) * units;
}

/**
 * A plan change is a downgrade when the customer ends up paying us less per
 * month, for the seats the workspace uses: €150 flat is less than €49 per seat
 * for 6 seats. Equal prices are treated as an upgrade so the change applies at
 * once.
 *
 * @param seats Seats the workspace uses; a per-seat price counts them
 */
export function isDowngrade(
  current: Plan | null,
  target: Plan,
  seats = MIN_BILLED_SEATS,
): boolean {
  if (!current) return false;
  return monthlyCost(target, seats) < monthlyCost(current, seats);
}

/**
 * Feature fields written once per locale and read in the caller's.
 */
export const FEATURE_LOCALIZED_FIELDS: Array<keyof Feature> = [
  "displayName",
  "tooltip",
];

/**
 * Unlocks a feature's localized texts in one locale, falling back to
 * the feature table's fallback locale where that one has no value.
 *
 * @param feature Feature read from the catalog
 * @param locale Reader's locale, e.g. `fr`
 */
export function localizeFeature(feature: Feature, locale: string): Feature {
  return feature.localize(locale, FEATURE_LOCALIZED_FIELDS);
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
    checkoutAvailable: !!plan.paymentProviderRefs?.stripePriceId,
    featureValues,
  };
}

/**
 * Comparison-table payload: one column per plan with its inherited feature
 * values already resolved, and the feature catalogue carrying the display
 * metadata the table renders rows from, worded in the reader's locale.
 *
 * @param planModel Plan catalog
 * @param featureModel Feature catalog
 * @param plans Plans to compare
 * @param locale Locale the feature labels and tooltips are read in
 */
export async function buildTenantPlanCatalog(
  planModel: PlanModel,
  featureModel: FeatureModel,
  plans: Plan[],
  locale: string,
): Promise<TenantPlanCatalog> {
  const features = await featureModel.getAll();
  const knownFeatureIds = new Set(features.map((feature) => feature._id));
  const views = await Promise.all(
    plans.map((plan) => toPlanView(planModel, plan, knownFeatureIds)),
  );
  return {
    plans: views.sort((left, right) => left.order - right.order),
    features: features
      .map((feature) => toPlanFeature(localizeFeature(feature, locale)))
      .sort((left, right) => left.order - right.order),
  };
}
