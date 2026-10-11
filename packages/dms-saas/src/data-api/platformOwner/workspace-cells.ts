import type { CellSubline, ComposedText } from "@antelopejs/interface-dms/base";
import type { WorkspaceDirectoryFields } from "../../db";
import {
  cellToneOf,
  composed,
  countParam,
  dateParam,
  moneyParam,
  valueText,
} from "../../i18n/composed-text";
import { monthlyAmountAfterTrial } from "../../metrics/directory-summary";
import { MS_PER_DAY } from "../../utils/time";
import { STATUS_TONES } from "../../utils/status-vocabulary";

/** The directory row the workspace list's two-line cells are written from. */
export type WorkspaceCellRow = Partial<WorkspaceDirectoryFields> & {
  billingState?: string | null;
};

const K = "saas.workspaces";
const YEARLY = "year";
const SEAT_BILLING = "seat";
// Without a currency, or before a first payment / after a cancellation, the
// workspace bills nothing worth an amount.
const STATES_WITHOUT_MRR = new Set(["pending_payment", "cancelled"]);
// What MRR means beside the amount when the workspace is not billed as usual.
const MRR_NOTES: Record<string, CellSubline> = {
  past_due: { text: `$${K}.mrr_cell.at_risk`, tone: "error" },
  suspended: { text: `$${K}.mrr_cell.billing_paused`, tone: "muted" },
};

function interval(row: WorkspaceCellRow): ComposedText {
  return composed(`${K}.interval.${row.planInterval ?? "month"}`);
}

/** "€29.00 × 23 seats / month", "€49.00 / month", "Complimentary". */
export function workspacePlanDetail(
  row: WorkspaceCellRow,
): ComposedText | null {
  if (!row.planName) return null;
  if (row.isComplimentary) return composed(`${K}.plan_cell.complimentary`);
  const price = moneyParam(row.planUnitAmountMinor ?? 0, row.currency ?? "");
  return row.planBillingMode === SEAT_BILLING
    ? composed(`${K}.plan_cell.price_times_seats`, {
        price,
        seats: row.seats ?? 0,
        interval: interval(row),
      })
    : composed(`${K}.plan_cell.price_flat`, { price, interval: interval(row) });
}

/** The MRR in the workspace's currency; none while it bills nothing. */
export function workspaceMrrAmount(row: WorkspaceCellRow): ComposedText | null {
  if (!row.currency || STATES_WITHOUT_MRR.has(row.billingState ?? ""))
    return null;
  return valueText(moneyParam(row.mrrMinor ?? 0, row.currency));
}

/** What the MRR means: at risk, paused, what a trial bills, yearly ÷ 12. */
export function workspaceMrrNote(row: WorkspaceCellRow): CellSubline | null {
  if (!workspaceMrrAmount(row)) return null;
  const note = MRR_NOTES[row.billingState ?? ""];
  if (note) return note;
  if (row.billingState === "trialing") {
    const then = monthlyAmountAfterTrial(row);
    return {
      text: composed(`${K}.mrr_cell.trial`, {
        amount: moneyParam(then.amountMinor, then.currency),
      }),
    };
  }
  if (row.planInterval === YEARLY && (row.mrrMinor ?? 0) > 0)
    return { text: `$${K}.mrr_cell.yearly` };
  return null;
}

/** The owner's name, else the address they were invited at. */
export function workspaceOwnerLabel(row: WorkspaceCellRow): string | null {
  return row.ownerName || row.ownerEmail || null;
}

/** Whether the owner joined, is invited, or let the invitation expire. */
export function workspaceOwnerState(row: WorkspaceCellRow): CellSubline {
  const status = row.ownerStatus ?? "none";
  return {
    text: `$saas.status.owner.${status}`,
    tone: cellToneOf(STATUS_TONES.owner[status]),
  };
}

function daysUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY));
}

/** "Renews", "Suspends in 3 days": what happens on the workspace's next date. */
export function workspaceRenewalSummary(
  row: WorkspaceCellRow,
  now: Date = new Date(),
): ComposedText | null {
  if (!row.renewalKind || !row.renewsAt) return null;
  return composed(`${K}.renewal.${row.renewalKind}`, {
    days: countParam(daysUntil(new Date(row.renewsAt), now)),
  });
}

/** The next date, red when the workspace will be suspended on it. */
export function workspaceRenewalDate(
  row: WorkspaceCellRow,
): CellSubline | null {
  if (!row.renewalKind || !row.renewsAt) return null;
  return {
    text: valueText(dateParam(row.renewsAt)),
    tone: row.renewalKind === "suspends" ? "error" : undefined,
  };
}
