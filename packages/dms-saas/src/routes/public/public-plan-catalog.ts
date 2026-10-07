import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  BillingSettingsModel,
  DEFAULT_DATA_RETENTION_DAYS,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  FeatureModel,
  type Plan,
  type PlanAudience,
  type PlanBillingMode,
  type PlanInterval,
  PlanModel,
  type RefundProrataMode,
} from "../../db";
import { buildTenantPlanCatalog, type TenantPlanFeature } from "../../plans";

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
  featureValues: Record<string, unknown>;
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
 * @param plan Plan read from the catalogue
 * @param featureValues Its feature values, inheritance resolved
 */
function toPublicPlan(
  plan: Plan,
  featureValues: Record<string, unknown>,
): PublicPlan {
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
 * Reads the public part of the billing rules, with the defaults the billing
 * code applies when the operator never saved them.
 *
 * @param settings Billing settings singleton, when it exists
 */
export function toPublicBillingRules(
  settings: BillingSettings | undefined,
): PublicBillingRules {
  return {
    moneyBackGuarantee: settings?.moneyBackGuaranteeEnabled
      ? {
          windowDays: settings.moneyBackGuaranteeWindowDays,
          mode: settings.moneyBackGuaranteeMode,
        }
      : null,
    dataRetentionDays:
      settings?.dataRetentionDaysAfterCancellation ??
      DEFAULT_DATA_RETENTION_DAYS,
    maxFreeWorkspacesPerCard:
      settings?.maxFreeWorkspacesPerCard ??
      DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
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
  reference: unknown,
): Plan | undefined {
  if (typeof reference !== "string" || reference.length === 0) return;
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
      return plan ? [toPublicPlan(plan, view.featureValues)] : [];
    }),
    features: catalog.features,
  };
}

/** The public billing rules as currently saved. */
export async function loadPublicBillingRules(): Promise<PublicBillingRules> {
  const settings = await GetModel(BillingSettingsModel).get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return toPublicBillingRules(settings);
}
