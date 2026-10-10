import type { StatGroupItem } from "@antelopejs/interface-dms/base";
import type { Plan } from "../db";
import {
  composed,
  dotList,
  moneyParam,
  valueText,
} from "../i18n/composed-text";
import type { CatalogueUsage, PlanUsage } from "./catalogue-usage";

/** MRR of the plans billed in one currency. */
export interface CurrencyMrr {
  currency: string;
  mrr: number;
}

/** The figures above the plan catalogue. */
export interface CatalogueSummary {
  /** Plans anyone can subscribe to, public or assigned by sales. */
  onSale: number;
  publicOnSale: number;
  salesLed: number;
  workspaces: number;
  paying: number;
  free: number;
  trialing: number;
  /** Normalised MRR per currency, the largest first. */
  mrr: CurrencyMrr[];
  /** Plans no longer sold but kept for the workspaces still on them. */
  legacy: number;
  legacyWorkspaces: number;
  /** Names of the legacy plans still holding workspaces, for the detail line. */
  legacyNames: string[];
}

type SummarisedPlan = Pick<Plan, "_id" | "name" | "isActive" | "isPublic">;

function usageOf(usage: CatalogueUsage, plan: SummarisedPlan): PlanUsage {
  return (
    usage.byPlan.get(plan._id) ?? {
      workspaces: 0,
      paying: 0,
      trialing: 0,
      free: 0,
      seats: 0,
      members: 0,
      mrr: 0,
    }
  );
}

function sumOf(
  plans: SummarisedPlan[],
  usage: CatalogueUsage,
  field: keyof PlanUsage,
): number {
  return plans.reduce((total, plan) => total + usageOf(usage, plan)[field], 0);
}

/**
 * The catalogue at a glance: what is on sale, how many workspaces each kind
 * of plan holds, the normalised MRR per currency, and the legacy plans still
 * holding workspaces (the ones to retire).
 *
 * @param plans Plans of the catalogue, deleted ones left out
 * @param usage Usage of the catalogue
 */
export function summariseCatalogue(
  plans: SummarisedPlan[],
  usage: CatalogueUsage,
): CatalogueSummary {
  const onSale = plans.filter((plan) => plan.isActive);
  const legacy = plans.filter((plan) => !plan.isActive);
  const legacyInUse = legacy.filter(
    (plan) => usageOf(usage, plan).workspaces > 0,
  );
  return {
    onSale: onSale.length,
    publicOnSale: onSale.filter((plan) => plan.isPublic).length,
    salesLed: onSale.filter((plan) => !plan.isPublic).length,
    workspaces: sumOf(plans, usage, "workspaces"),
    paying: sumOf(plans, usage, "paying"),
    free: sumOf(plans, usage, "free"),
    trialing: sumOf(plans, usage, "trialing"),
    mrr: [...usage.mrrByCurrency]
      .map(([currency, mrr]) => ({ currency, mrr }))
      .sort((left, right) => right.mrr - left.mrr),
    legacy: legacy.length,
    legacyWorkspaces: sumOf(legacy, usage, "workspaces"),
    legacyNames: legacyInUse.map((plan) => plan.name),
  };
}

const STATS = "saas.catalog.plans.stats";
const MINOR_UNITS_PER_UNIT = 100;
const NAMES_SEPARATOR = ", ";

function mrrParam(entry: CurrencyMrr) {
  return moneyParam(
    Math.round(entry.mrr * MINOR_UNITS_PER_UNIT),
    entry.currency,
  );
}

function mrrItem(summary: CatalogueSummary): StatGroupItem {
  const [main, ...rest] = summary.mrr;
  const others = rest.filter((entry) => entry.mrr > 0).map(mrrParam);
  const otherList = dotList(others);
  return {
    id: "mrr",
    icon: "i-ph-chart-line-up",
    eyebrow: `$${STATS}.mrr`,
    value: main ? valueText(mrrParam(main)) : "—",
    detail: otherList
      ? composed(`${STATS}.mrr_detail_other`, { other: otherList })
      : `$${STATS}.mrr_detail`,
  };
}

function legacyItem(summary: CatalogueSummary): StatGroupItem {
  const hasWorkspaces = summary.legacyWorkspaces > 0;
  return {
    id: "legacy",
    icon: "i-ph-clock-counter-clockwise",
    tone: hasWorkspaces ? "warning" : undefined,
    eyebrow: `$${STATS}.legacy`,
    value: summary.legacy,
    detail:
      summary.legacyNames.length === 0
        ? `$${STATS}.legacy_none`
        : composed(`${STATS}.legacy_detail`, {
            names: summary.legacyNames.join(NAMES_SEPARATOR),
            count: summary.legacyWorkspaces,
          }),
    detailTone: hasWorkspaces ? "warning" : undefined,
  };
}

/**
 * The catalogue's figures as a `StatGroup` reads them: plans on sale,
 * workspaces, normalised MRR, legacy plans still holding workspaces.
 *
 * @param summary The catalogue summary
 */
export function catalogueStatItems(summary: CatalogueSummary): StatGroupItem[] {
  return [
    {
      id: "on-sale",
      icon: "i-ph-storefront",
      eyebrow: `$${STATS}.on_sale`,
      value: summary.onSale,
      detail: composed(`${STATS}.on_sale_detail`, {
        public: summary.publicOnSale,
        sales: summary.salesLed,
      }),
    },
    {
      id: "workspaces",
      icon: "i-ph-buildings",
      eyebrow: `$${STATS}.workspaces`,
      value: summary.workspaces,
      detail: composed(`${STATS}.workspaces_detail`, {
        paying: summary.paying,
        free: summary.free,
        trialing: summary.trialing,
      }),
    },
    mrrItem(summary),
    legacyItem(summary),
  ];
}
