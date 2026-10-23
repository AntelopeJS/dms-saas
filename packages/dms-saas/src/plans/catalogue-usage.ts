import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type BillingState,
  type Plan,
  PlanModel,
  type TenantBillingState,
  TenantBillingStateModel,
} from "../db";
import {
  isBilledState,
  monthlyAmountMinor,
  planUnitAmountMinor,
} from "../metrics/normalised-mrr";
import { fromMinorUnits } from "../utils/money";

const TRIALING_STATE: BillingState = "trialing";
const FREE_STATE: BillingState = "free";
const CENTS_PRECISION = 100;

/** The plan fields normalised MRR reads. */
export type MrrPlan = Pick<
  Plan,
  "price" | "currency" | "interval" | "billingMode"
>;

/** The billing fields normalised MRR reads. */
export interface MrrSubscription {
  status: BillingState;
  isComplimentary: boolean;
}

/** One workspace on one plan, as the catalogue counts it. */
export interface PlanUsageRow {
  tenantId: string;
  planId: string;
  status: BillingState;
  isComplimentary: boolean;
  /** Seats billed: members and pending invitations, platform support aside. */
  seats: number;
  /** Members in the workspace, platform support aside. */
  members: number;
  /** Plan a scheduled change moves the workspace to at renewal. */
  pendingPlanId: string | null;
}

/**
 * What one plan weighs in the catalogue. The buckets are the dashboard's: a
 * workspace is paying when it brings MRR, trialing or free by its billing
 * state. Cancelled, suspended, awaiting a first payment or complimentary, it
 * counts in `workspaces` only.
 */
export interface PlanUsage {
  workspaces: number;
  paying: number;
  trialing: number;
  free: number;
  seats: number;
  members: number;
  /** Normalised monthly recurring revenue, in the plan's currency. */
  mrr: number;
  /** Workspaces on another plan scheduled to switch to this one at renewal. */
  scheduled: number;
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
  return isBilledState(subscription.status) && !subscription.isComplimentary;
}

/**
 * What one billed workspace pays per month: a yearly price divided by 12, a
 * per-seat price times the seats billed.
 */
export function normalisedMonthlyAmount(plan: MrrPlan, seats: number): number {
  return fromMinorUnits(
    monthlyAmountMinor(
      {
        unitAmountMinor: planUnitAmountMinor(plan),
        interval: plan.interval,
        billingMode: plan.billingMode,
      },
      seats,
    ),
    plan.currency,
  );
}

/** The usage of a plan no workspace holds nor is scheduled to switch to. */
export function emptyPlanUsage(): PlanUsage {
  return {
    workspaces: 0,
    paying: 0,
    trialing: 0,
    free: 0,
    seats: 0,
    members: 0,
    mrr: 0,
    scheduled: 0,
  };
}

function addRow(usage: PlanUsage, plan: MrrPlan, row: PlanUsageRow): void {
  usage.workspaces += 1;
  usage.seats += row.seats;
  usage.members += row.members;
  if (row.status === TRIALING_STATE) {
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
  if (row.status === FREE_STATE) usage.free += 1;
}

/**
 * Counts each plan's workspaces (paying, in trial, free — see
 * {@link PlanUsage}), seats and members,
 * the workspaces scheduled to switch to it, and its normalised MRR (yearly
 * ÷ 12, per seat × seats, trials, complimentary access and free plans
 * excluded). Rows of an unknown plan are
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
  const byPlan = new Map(plans.map((plan) => [plan._id, emptyPlanUsage()]));
  for (const row of rows) {
    const plan = plansById.get(row.planId);
    const usage = byPlan.get(row.planId);
    if (plan && usage) addRow(usage, plan, row);
    const scheduledUsage =
      row.pendingPlanId && row.pendingPlanId !== row.planId
        ? byPlan.get(row.pendingPlanId)
        : undefined;
    if (scheduledUsage) scheduledUsage.scheduled += 1;
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

/**
 * A live workspace's directory row, the one the dashboard reads too: keyed by
 * its tenant, not deleted, holding a plan.
 */
function toUsageRow(row: TenantBillingState): PlanUsageRow | undefined {
  if (!row.planId || row.deletedAt || row._id !== row.tenantId)
    return undefined;
  return {
    tenantId: row.tenantId,
    planId: row.planId,
    status: row.billingState,
    isComplimentary: row.isComplimentary,
    seats: row.seats,
    members: row.members,
    pendingPlanId: row.pendingPlanId,
  };
}

/**
 * One row per workspace holding a plan, with its seats and members, read
 * from the workspace directory.
 *
 * @param planId Only the workspaces of this plan; every plan without it
 */
export async function loadPlanUsageRows(
  planId?: string,
): Promise<PlanUsageRow[]> {
  const model = GetModel(TenantBillingStateModel);
  const rows = planId ? await model.findByPlan(planId) : await model.getAll();
  return rows
    .map(toUsageRow)
    .filter((row): row is PlanUsageRow => row !== undefined);
}

async function readCatalogueUsage(): Promise<CatalogueUsage> {
  const [plans, rows] = await Promise.all([
    GetModel(PlanModel).findNotDeleted(),
    loadPlanUsageRows(),
  ]);
  return summariseCatalogueUsage(plans, rows);
}

let inFlightUsage: Promise<CatalogueUsage> | undefined;

/**
 * {@link summariseCatalogueUsage} over the stored plans and workspaces. Every
 * plan row of a listing reads it from its getters at once: the reads made
 * while one runs share it.
 */
export function loadCatalogueUsage(): Promise<CatalogueUsage> {
  inFlightUsage ??= readCatalogueUsage().finally(() => {
    inFlightUsage = undefined;
  });
  return inFlightUsage;
}
