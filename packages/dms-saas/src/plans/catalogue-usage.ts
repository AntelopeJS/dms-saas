import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { monthlyPrice } from "@antelopejs/interface-dms-saas/plans";
import {
  type Plan,
  type TenantSubscription,
  type TenantSubscriptionStatus,
  PlanModel,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "../utils/row-instance";
import { getSeatUsage } from "./seat-capacity";

/** Statuses whose subscription is billed: trials and lapsed ones are not. */
const BILLED_STATUSES: ReadonlySet<TenantSubscriptionStatus> = new Set([
  "active",
  "past_due",
]);
const TRIALING_STATUS: TenantSubscriptionStatus = "trialing";
const SEAT_BILLING_MODE = "seat";
const CENTS_PRECISION = 100;
/** How long one read of every subscription serves the plan rows of a page. */
const USAGE_CACHE_TTL_MS = 5_000;

/** The plan fields normalised MRR reads. */
export type MrrPlan = Pick<Plan, "price" | "interval" | "billingMode">;

/** The subscription fields normalised MRR reads. */
export type MrrSubscription = Pick<
  TenantSubscription,
  "status" | "isComplimentary"
>;

/** One workspace on one plan, as the catalogue counts it. */
export interface PlanUsageRow {
  tenantId: string;
  planId: string;
  status: TenantSubscriptionStatus;
  isComplimentary: boolean;
  /** Seats billed: members and pending invitations, platform support aside. */
  seats: number;
  /** Members in the workspace, platform support aside. */
  members: number;
}

/** What one plan weighs in the catalogue. */
export interface PlanUsage {
  workspaces: number;
  paying: number;
  trialing: number;
  free: number;
  seats: number;
  members: number;
  /** Normalised monthly recurring revenue, in the plan's currency. */
  mrr: number;
}

/** Usage of every plan, and the MRR of the catalogue per currency. */
export interface CatalogueUsage {
  byPlan: Map<string, PlanUsage>;
  mrrByCurrency: Map<string, number>;
}

function roundCents(amount: number): number {
  return Math.round(amount * CENTS_PRECISION) / CENTS_PRECISION;
}

/**
 * Whether a subscription brings recurring revenue: billed (active or past
 * due), and paid for rather than granted. Trials, complimentary access and
 * lapsed workspaces bring none.
 */
export function isBilledSubscription(subscription: MrrSubscription): boolean {
  return (
    BILLED_STATUSES.has(subscription.status) && !subscription.isComplimentary
  );
}

/**
 * What one billed workspace pays per month: a yearly price divided by 12, a
 * per-seat price times the seats billed.
 */
export function normalisedMonthlyAmount(plan: MrrPlan, seats: number): number {
  const perPeriod =
    plan.billingMode === SEAT_BILLING_MODE ? plan.price * seats : plan.price;
  return monthlyPrice({ ...plan, price: perPeriod } as Plan);
}

function emptyUsage(): PlanUsage {
  return {
    workspaces: 0,
    paying: 0,
    trialing: 0,
    free: 0,
    seats: 0,
    members: 0,
    mrr: 0,
  };
}

function addRow(usage: PlanUsage, plan: MrrPlan, row: PlanUsageRow): void {
  usage.workspaces += 1;
  usage.seats += row.seats;
  usage.members += row.members;
  if (row.status === TRIALING_STATUS) {
    usage.trialing += 1;
    return;
  }
  const amount = isBilledSubscription(row)
    ? normalisedMonthlyAmount(plan, row.seats)
    : 0;
  if (amount > 0) {
    usage.paying += 1;
    usage.mrr = roundCents(usage.mrr + amount);
    return;
  }
  usage.free += 1;
}

/**
 * Counts each plan's workspaces (paying, in trial, free), seats and members,
 * and its normalised MRR (Q23: yearly ÷ 12, per seat × seats, trials,
 * complimentary access and free plans excluded). Rows of an unknown plan are
 * left out.
 *
 * @param plans Plans of the catalogue
 * @param rows One row per workspace subscription
 */
export function summariseCatalogueUsage(
  plans: Array<MrrPlan & Pick<Plan, "_id" | "currency">>,
  rows: PlanUsageRow[],
): CatalogueUsage {
  const plansById = new Map(plans.map((plan) => [plan._id, plan]));
  const byPlan = new Map(plans.map((plan) => [plan._id, emptyUsage()]));
  for (const row of rows) {
    const plan = plansById.get(row.planId);
    const usage = byPlan.get(row.planId);
    if (plan && usage) addRow(usage, plan, row);
  }
  const mrrByCurrency = new Map<string, number>();
  for (const plan of plans) {
    const mrr = byPlan.get(plan._id)?.mrr ?? 0;
    const currency = plan.currency.toUpperCase();
    mrrByCurrency.set(
      currency,
      roundCents((mrrByCurrency.get(currency) ?? 0) + mrr),
    );
  }
  return { byPlan, mrrByCurrency };
}

/**
 * A plan's share of the MRR of the plans billed in its currency, from 0 to 1.
 *
 * @param usage Usage of the catalogue
 * @param plan The plan
 */
export function planMrrShare(
  usage: CatalogueUsage,
  plan: Pick<Plan, "_id" | "currency">,
): number {
  const total = usage.mrrByCurrency.get(plan.currency.toUpperCase()) ?? 0;
  const mrr = usage.byPlan.get(plan._id)?.mrr ?? 0;
  return total > 0 ? mrr / total : 0;
}

async function toUsageRow(
  subscription: TenantSubscription,
): Promise<PlanUsageRow | undefined> {
  if (!subscription.planId) return undefined;
  const tenantId = getRowInstance(subscription);
  const seatUsage = await getSeatUsage(tenantId);
  return {
    tenantId,
    planId: subscription.planId,
    status: subscription.status,
    isComplimentary: !!subscription.isComplimentary,
    seats: seatUsage.occupied,
    members: seatUsage.members,
  };
}

/**
 * One row per workspace holding a plan, with its seats and members.
 *
 * @param planId Only the workspaces of this plan; every plan without it
 */
export async function loadPlanUsageRows(
  planId?: string,
): Promise<PlanUsageRow[]> {
  const model = GetModel(TenantSubscriptionModel, CROSS_INSTANCE);
  const subscriptions = planId
    ? await model.findByPlan(planId)
    : await model.getAll();
  const rows = await Promise.all(subscriptions.map(toUsageRow));
  return rows.filter((row): row is PlanUsageRow => row !== undefined);
}

interface CachedUsage {
  expiresAt: number;
  usage: Promise<CatalogueUsage>;
}

let cachedUsage: CachedUsage | undefined;

async function readCatalogueUsage(): Promise<CatalogueUsage> {
  const [plans, rows] = await Promise.all([
    GetModel(PlanModel).findNotDeleted(),
    loadPlanUsageRows(),
  ]);
  return summariseCatalogueUsage(plans, rows);
}

/**
 * {@link summariseCatalogueUsage} over the stored plans and subscriptions.
 * Every plan row of a listing reads it, so one read serves the rows of a
 * request (and of the few seconds after it).
 */
export function loadCatalogueUsage(): Promise<CatalogueUsage> {
  const now = Date.now();
  if (cachedUsage && cachedUsage.expiresAt > now) return cachedUsage.usage;
  const usage = readCatalogueUsage();
  cachedUsage = { expiresAt: now + USAGE_CACHE_TTL_MS, usage };
  usage.catch(() => {
    cachedUsage = undefined;
  });
  return usage;
}
