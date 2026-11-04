import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type BillingSettings,
  FeatureModel,
  type Plan,
  type PlanAudience,
  type PlanBillingMode,
  type PlanInterval,
  PlanModel,
  type RefundProrataMode,
} from "../../db";
import {
  buildTenantPlanCatalog,
  localizePlan,
  type TenantPlanFeature,
} from "../../plans";
import { loadBillingSettings } from "../../operator-billing/billing-settings-store";
import { isString } from "../../utils/primitive-guards";
import type { QueryParameterValue } from "../../utils/query-parameter";
import type { TenantPlanView } from "@antelopejs/interface-dms-saas/plans";

/**
 * A plan as a visitor reads it on the pricing and sign-up screens: what it
 * costs, how it bills, what it includes. Nothing operational (Stripe ids,
 * permissions, migration state) leaves the server.
 */
export interface PublicPlan {
  _id: string;
  slug: string;
  name: string;
  description: string;
  audience: PlanAudience;
  /** Major units of `currency`, per `interval` (and per member for `seat`). */
  price: number;
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
  trialDays: number;
  /** -1 means unlimited members. */
  maxMembers: number;
  borderColor: string | null;
  borderLabel: string | null;
  order: number;
  /** The plan this one extends, for "Everything in Free, plus". */
  inheritsFromPlanId: string | null;
  /** Resolved through inheritance, keyed by feature id. */
  featureValues: TenantPlanView["featureValues"];
}

/** Plans and the feature rows their values are read against. */
export interface PublicPlanCatalog {
  plans: PublicPlan[];
  features: TenantPlanFeature[];
}

/** The money-back guarantee as a visitor is promised it. */
export interface PublicMoneyBackGuarantee {
  windowDays: number;
  mode: RefundProrataMode;
}

/**
 * The billing rules a visitor may read before signing up: the guarantee,
 * how long a closed workspace's data is kept, how many free workspaces a card
 * backs. Dunning delays and tax codes stay on the operator side.
 */
export interface PublicBillingRules {
  moneyBackGuarantee: PublicMoneyBackGuarantee | null;
  dataRetentionDays: number;
  maxFreeWorkspacesPerCard: number;
}

/**
 * Projects a plan for the public screens.
 *
 * @param catalogued Plan read from the catalogue
 * @param featureValues Its feature values, inheritance resolved
 * @param locale Reader's locale its texts are read in
 */
function toPublicPlan(
  catalogued: Plan,
  featureValues: TenantPlanView["featureValues"],
  locale: string,
): PublicPlan {
  const plan = localizePlan(catalogued, locale);
  return {
    _id: plan._id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description ?? "",
    audience: plan.audience,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    trialDays: plan.trialDays ?? 0,
    maxMembers: plan.maxMembers,
    borderColor: plan.borderColor ?? null,
    borderLabel: plan.borderLabel ?? null,
    order: plan.order,
    inheritsFromPlanId: plan.inheritsFromPlanId ?? null,
    featureValues,
  };
}

/**
 * Reads the public part of the billing rules.
 *
 * @param settings Billing settings singleton
 */
export function toPublicBillingRules(
  settings: BillingSettings,
): PublicBillingRules {
  return {
    moneyBackGuarantee: settings.moneyBackGuaranteeEnabled
      ? {
          windowDays: settings.moneyBackGuaranteeWindowDays,
          mode: settings.moneyBackGuaranteeMode,
        }
      : null,
    dataRetentionDays: settings.dataRetentionDaysAfterCancellation,
    maxFreeWorkspacesPerCard: settings.maxFreeWorkspacesPerCard,
  };
}

/**
 * The plan a sign-up link names, by slug (what `/pricing` links with) or id.
 *
 * @param plans Plans the visitor may pick from
 * @param reference Slug or id from the `plan` query parameter
 */
export function findPlanByReference(
  plans: Plan[],
  reference: QueryParameterValue | string[],
): Plan | undefined {
  if (!isString(reference) || reference.length === 0) return;
  return (
    plans.find((plan) => plan.slug === reference) ??
    plans.find((plan) => plan._id === reference)
  );
}

/**
 * Projects plans with their resolved feature values and the feature rows,
 * worded in the reader's locale.
 *
 * @param plans Plans to show, in any order
 * @param locale Reader's locale
 */
export async function loadPublicPlanCatalog(
  plans: Plan[],
  locale: string,
): Promise<PublicPlanCatalog> {
  const catalog = await buildTenantPlanCatalog(
    GetModel(PlanModel),
    GetModel(FeatureModel),
    plans,
    locale,
  );
  const plansById = new Map(plans.map((plan) => [plan._id, plan]));
  return {
    plans: catalog.plans.flatMap((view) => {
      const plan = plansById.get(view._id);
      return plan ? [toPublicPlan(plan, view.featureValues, locale)] : [];
    }),
    features: catalog.features,
  };
}

/** The public billing rules as currently saved. */
export async function loadPublicBillingRules(): Promise<PublicBillingRules> {
  return toPublicBillingRules(await loadBillingSettings());
}
