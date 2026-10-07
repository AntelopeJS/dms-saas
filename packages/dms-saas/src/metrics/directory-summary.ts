import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import {
  BILLING_STATES,
  type BillingState,
  type TenantBillingState,
  TenantBillingStateModel,
  type WorkspaceDirectoryFields,
} from "../db";
import { MS_PER_DAY } from "../utils/time";
import {
  type MinorAmount,
  monthlyAmountMinor,
  type ReportingTotal,
  sumInReportingCurrency,
} from "./normalised-mrr";

/** Days ahead a trial ending, or complimentary access ending, is flagged. */
const TRIAL_ENDING_WINDOW_DAYS = 14;
const COMPLIMENTARY_ENDING_WINDOW_DAYS = 7;

/** A workspace directory row: the billing state and its denormalised fields. */
export type DirectoryRow = TenantBillingState;

/** A workspace named on a dashboard or list headline. */
export interface DatedWorkspace {
  tenantId: string;
  name: string;
  at: Date;
}

/** Past-due workspaces: how many, the MRR at risk, the first suspension. */
export interface PastDueSummary {
  count: number;
  atRisk: ReportingTotal;
  firstSuspension: Date | null;
}

/** Trials ending soon, and what they bill once they convert. */
export interface TrialsEndingSummary {
  count: number;
  thenMrr: ReportingTotal;
}

/** What the dashboard and the workspace list headline. */
export interface DirectorySummary {
  total: number;
  byState: Record<BillingState, number>;
  mrr: ReportingTotal;
  paying: number;
  pastDue: PastDueSummary;
  trialsEnding: TrialsEndingSummary;
  complimentaryEnding: DatedWorkspace[];
}

function emptyStateCounts(): Record<BillingState, number> {
  return Object.fromEntries(
    BILLING_STATES.map((state) => [state, 0]),
  ) as Record<BillingState, number>;
}

function mrrOf(row: DirectoryRow): MinorAmount {
  return { amountMinor: row.mrrMinor ?? 0, currency: row.currency ?? "" };
}

/** What a trial bills per month once it converts, at its current seats. */
export function monthlyAmountAfterTrial(
  row: Partial<WorkspaceDirectoryFields>,
): MinorAmount {
  if (!row.planInterval || !row.planBillingMode || !row.currency)
    return { amountMinor: 0, currency: row.currency ?? "" };
  return {
    amountMinor: monthlyAmountMinor(
      {
        unitAmountMinor: row.planUnitAmountMinor ?? 0,
        interval: row.planInterval,
        billingMode: row.planBillingMode,
      },
      row.seats ?? 0,
    ),
    currency: row.currency,
  };
}

function isDueWithin(
  row: DirectoryRow,
  kind: string,
  now: Date,
  days: number,
): boolean {
  if (row.renewalKind !== kind || !row.renewsAt) return false;
  const at = new Date(row.renewsAt).getTime();
  return at >= now.getTime() && at <= now.getTime() + days * MS_PER_DAY;
}

function earliest(dates: Date[]): Date | null {
  return dates.reduce<Date | null>(
    (first, date) => (!first || date < first ? date : first),
    null,
  );
}

function summarisePastDue(
  rows: DirectoryRow[],
  currency: string,
): PastDueSummary {
  const pastDue = rows.filter((row) => row.billingState === "past_due");
  return {
    count: pastDue.length,
    atRisk: sumInReportingCurrency(pastDue.map(mrrOf), currency),
    firstSuspension: earliest(
      pastDue
        .filter((row) => row.renewalKind === "suspends" && row.renewsAt)
        .map((row) => new Date(row.renewsAt as Date)),
    ),
  };
}

/** Aggregates the directory rows; complimentary endings come without names. */
export function summariseDirectory(
  rows: DirectoryRow[],
  now: Date,
  reportingCurrency: string,
): DirectorySummary {
  const byState = rows.reduce((counts, row) => {
    counts[row.billingState] += 1;
    return counts;
  }, emptyStateCounts());
  const trials = rows.filter((row) =>
    isDueWithin(row, "trial_ends", now, TRIAL_ENDING_WINDOW_DAYS),
  );
  const complimentaryEnding = rows
    .filter((row) =>
      isDueWithin(row, "free_until", now, COMPLIMENTARY_ENDING_WINDOW_DAYS),
    )
    .map((row) => ({
      tenantId: row.tenantId,
      name: "",
      at: new Date(row.renewsAt as Date),
    }))
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  return {
    total: rows.length,
    byState,
    mrr: sumInReportingCurrency(rows.map(mrrOf), reportingCurrency),
    paying: rows.filter((row) => (row.mrrMinor ?? 0) > 0).length,
    pastDue: summarisePastDue(rows, reportingCurrency),
    trialsEnding: {
      count: trials.length,
      thenMrr: sumInReportingCurrency(
        trials.map(monthlyAmountAfterTrial),
        reportingCurrency,
      ),
    },
    complimentaryEnding,
  };
}

/** Every live workspace's directory row; tombstones of deleted ones are left out. */
export async function loadDirectoryRows(): Promise<DirectoryRow[]> {
  return GetModel(TenantBillingStateModel)
    .table.filter((row) =>
      row
        .key("deletedAt")
        .eq(null)
        .and(row.key("_id").eq(row.key("tenantId"))),
    )
    .run();
}

/** Puts the workspace names on dated entries, dropping deleted workspaces. */
export async function nameWorkspaces(
  entries: DatedWorkspace[],
): Promise<DatedWorkspace[]> {
  if (entries.length === 0) return [];
  const tenants = await GetModel(TenantModel).getMany(
    entries.map((entry) => entry.tenantId),
  );
  const names = new Map(tenants.map((tenant) => [tenant._id, tenant.name]));
  return entries
    .filter((entry) => names.has(entry.tenantId))
    .map((entry) => ({ ...entry, name: names.get(entry.tenantId) ?? "" }));
}
