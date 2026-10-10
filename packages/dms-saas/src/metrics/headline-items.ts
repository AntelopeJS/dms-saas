import type {
  ComposedText,
  ComposedTextMoneyParam,
  KeyValueListItem,
  NavCardItem,
  StatGroupItem,
  TopListItem,
} from "@antelopejs/interface-dms/base";
import { BILLING_STATES } from "../db";
import {
  commaList,
  composed,
  countParam,
  dateParam,
  dotList,
  moneyParam,
  valueText,
} from "../i18n/composed-text";
import {
  INVOICES_PAGE_PATH,
  PLAN_MIGRATIONS_PAGE_PATH,
  planEditPath,
  workspacesTabPath,
  workspacesViewPath,
} from "../pages/platform/paths";
import { STATUS_TONES } from "../utils/status-vocabulary";
import type {
  DatedWorkspace,
  DirectoryRow,
  DirectorySummary,
} from "./directory-summary";
import type { ReportingTotal } from "./normalised-mrr";

/** Ids of the workspace list's predefined views, shared with its page. */
export const WORKSPACE_VIEW_IDS = {
  complimentaryEnding: "complimentary-ending",
  pastDueOverSevenDays: "past-due-7-days",
  trialsEnding: "trials-ending",
  ownerNeverJoined: "owner-never-joined",
  mrrOver500: "mrr-over-500",
} as const;

/** Migrations an operator has to look at, as the attention card names them. */
export interface MigrationAttention {
  count: number;
  firstFromPlan: string;
  firstToPlan: string;
  firstFailed: number;
  firstTotal: number;
}

/** Open invoices awaiting payment, in the reporting currency. */
export interface OpenInvoicesAttention {
  count: number;
  awaiting: ReportingTotal;
}

/** Everything the "Needs attention" grid is built from. */
export interface AttentionInputs {
  summary: DirectorySummary;
  complimentaryEnding: DatedWorkspace[];
  migrations: MigrationAttention;
  openInvoices: OpenInvoicesAttention;
}

const K = "saas.dashboard";
const W = "saas.workspaces.headline";
const NAMED_ENDINGS_SHOWN = 2;
const MONTHS_PER_YEAR = 12;

function money(total: ReportingTotal): ComposedTextMoneyParam {
  return moneyParam(total.amountMinor, total.currency);
}

/** "$1,200.00 in USD not counted": what the reporting total leaves out. */
function otherCurrenciesNote(total: ReportingTotal): ComposedText | null {
  const amounts = commaList(
    total.otherCurrencies.map((other) =>
      moneyParam(other.amountMinor, other.currency),
    ),
  );
  return amounts ? composed(`${K}.other_currencies`, { amounts }) : null;
}

function namedEndings(
  endings: DatedWorkspace[],
  key: string,
): ComposedText | null {
  return dotList(
    endings
      .slice(0, NAMED_ENDINGS_SHOWN)
      .map((ending) =>
        composed(key, { name: ending.name, date: dateParam(ending.at, "day") }),
      ),
  );
}

function mrrItem(
  summary: DirectorySummary,
  detail: ComposedText,
): StatGroupItem {
  const note = otherCurrenciesNote(summary.mrr);
  return {
    id: "mrr",
    icon: "i-ph-currency-circle-dollar",
    tone: "primary",
    eyebrow: `$${K}.headline.mrr`,
    value: valueText(money(summary.mrr)),
    detail: note ? dotList([detail, note])! : detail,
  };
}

/** The dashboard's headline figures: MRR, paying workspaces, trials. */
export function dashboardHeadline(summary: DirectorySummary): StatGroupItem[] {
  const arr = {
    ...summary.mrr,
    amountMinor: summary.mrr.amountMinor * MONTHS_PER_YEAR,
  };
  return [
    mrrItem(summary, composed(`${K}.headline.arr`, { arr: money(arr) })),
    {
      id: "paying",
      icon: "i-ph-buildings",
      eyebrow: `$${K}.headline.paying`,
      value: composed(`${K}.headline.paying_value`, {
        paying: summary.paying,
        total: summary.total,
      }),
      detail: composed(`${K}.headline.paying_detail`, {
        free: summary.byState.free,
        trialing: summary.byState.trialing,
      }),
      to: workspacesTabPath("active"),
    },
    {
      id: "trials",
      icon: "i-ph-hourglass-medium",
      tone: "info",
      eyebrow: `$${K}.headline.trials`,
      value: summary.byState.trialing,
      detail: composed(`${K}.headline.trials_detail`, {
        count: countParam(summary.trialsEnding.count),
      }),
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.trialsEnding),
    },
  ];
}

function pastDueDetail(summary: DirectorySummary): ComposedText {
  const { atRisk, firstSuspension } = summary.pastDue;
  const amount = money(atRisk);
  return firstSuspension
    ? composed(`${W}.past_due_detail`, {
        amount,
        date: dateParam(firstSuspension, "day"),
      })
    : composed(`${W}.past_due_detail_no_suspension`, { amount });
}

/** The workspace list's headline: MRR, past due, endings to act on. */
export function workspacesHeadline(
  summary: DirectorySummary,
  complimentaryEnding: DatedWorkspace[],
): StatGroupItem[] {
  return [
    mrrItem(
      summary,
      composed(`${W}.mrr_detail`, { count: countParam(summary.paying) }),
    ),
    {
      id: "past_due",
      icon: "i-ph-warning-circle",
      tone: summary.pastDue.count > 0 ? "error" : "muted",
      eyebrow: `$${W}.past_due`,
      value: summary.pastDue.count,
      detail: pastDueDetail(summary),
      detailTone: summary.pastDue.count > 0 ? "error" : undefined,
      to: workspacesTabPath("past_due"),
    },
    {
      id: "complimentary_ending",
      icon: "i-ph-gift",
      tone: complimentaryEnding.length > 0 ? "warning" : "muted",
      eyebrow: `$${W}.complimentary_ending`,
      value: complimentaryEnding.length,
      detail:
        namedEndings(complimentaryEnding, `${W}.named_ending`) ??
        `$${W}.none_this_week`,
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.complimentaryEnding),
    },
    {
      id: "trials_ending",
      icon: "i-ph-hourglass-medium",
      tone: "info",
      eyebrow: `$${W}.trials_ending`,
      value: summary.trialsEnding.count,
      detail: composed(`${W}.trials_ending_detail`, {
        amount: money(summary.trialsEnding.thenMrr),
      }),
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.trialsEnding),
    },
  ];
}

function pastDueCard(summary: DirectorySummary): NavCardItem {
  return {
    id: "past_due",
    icon: "i-ph-warning-circle",
    iconTone: "error",
    title: composed(`${K}.attention.past_due`, {
      count: countParam(summary.pastDue.count),
    }),
    description: pastDueDetail(summary),
    to: workspacesTabPath("past_due"),
  };
}

function complimentaryCard(endings: DatedWorkspace[]): NavCardItem {
  return {
    id: "complimentary_ending",
    icon: "i-ph-gift",
    iconTone: "warning",
    title: composed(`${K}.attention.complimentary_ending`, {
      count: countParam(endings.length),
    }),
    description:
      namedEndings(endings, `${K}.attention.named_ending`) ?? undefined,
    to: workspacesViewPath(WORKSPACE_VIEW_IDS.complimentaryEnding),
  };
}

function migrationsCard(migrations: MigrationAttention): NavCardItem {
  return {
    id: "migrations",
    icon: "i-ph-arrows-clockwise",
    iconTone: "error",
    title: composed(`${K}.attention.migrations`, {
      count: countParam(migrations.count),
    }),
    description: composed(`${K}.attention.migrations_detail`, {
      from: migrations.firstFromPlan,
      to: migrations.firstToPlan,
      failed: migrations.firstFailed,
      total: migrations.firstTotal,
    }),
    to: PLAN_MIGRATIONS_PAGE_PATH,
  };
}

function openInvoicesCard(open: OpenInvoicesAttention): NavCardItem {
  return {
    id: "open_invoices",
    icon: "i-ph-receipt",
    iconTone: "warning",
    title: composed(`${K}.attention.open_invoices`, {
      count: countParam(open.count),
    }),
    description: composed(`${K}.attention.open_invoices_detail`, {
      amount: money(open.awaiting),
    }),
    to: `${INVOICES_PAGE_PATH}?tab=open`,
  };
}

/** One card per queue that holds something; an empty queue shows nothing. */
export function attentionCards(inputs: AttentionInputs): NavCardItem[] {
  const queues: Array<[number, () => NavCardItem]> = [
    [inputs.summary.pastDue.count, () => pastDueCard(inputs.summary)],
    [
      inputs.complimentaryEnding.length,
      () => complimentaryCard(inputs.complimentaryEnding),
    ],
    [inputs.migrations.count, () => migrationsCard(inputs.migrations)],
    [inputs.openInvoices.count, () => openInvoicesCard(inputs.openInvoices)],
  ];
  return queues.filter(([count]) => count > 0).map(([, card]) => card());
}

/** Workspaces per status, each in its status tone, linking to its tab. */
export function workspacesByStatusItems(
  summary: DirectorySummary,
): KeyValueListItem[] {
  return BILLING_STATES.map((state) => ({
    id: state,
    label: `$saas.status.workspace.${state}`,
    value: summary.byState[state],
    tone: STATUS_TONES.workspace[state],
    to: workspacesTabPath(state),
  }));
}

interface PlanGroup {
  planId: string;
  name: string;
  workspaces: number;
  mrrMinor: number;
  row: DirectoryRow;
}

function groupByPlan(rows: DirectoryRow[], currency: string): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    if (!row.planId || !row.mrrMinor || row.currency !== currency) continue;
    const group = groups.get(row.planId) ?? {
      planId: row.planId,
      name: row.planName ?? "—",
      workspaces: 0,
      mrrMinor: 0,
      row,
    };
    group.workspaces += 1;
    group.mrrMinor += row.mrrMinor;
    groups.set(row.planId, group);
  }
  return [...groups.values()];
}

function planPriceLabel(row: DirectoryRow): ComposedText {
  const key = row.planBillingMode === "seat" ? "price_per_seat" : "price_flat";
  return composed(`saas.workspaces.plan_cell.${key}`, {
    price: moneyParam(row.planUnitAmountMinor ?? 0, row.currency ?? ""),
    interval: composed(`saas.workspaces.interval.${row.planInterval}`),
  });
}

/** Plans ranked by the MRR they bring, in the reporting currency. */
export function plansByMrrItems(
  rows: DirectoryRow[],
  currency: string,
): TopListItem[] {
  return groupByPlan(rows, currency)
    .sort((left, right) => right.mrrMinor - left.mrrMinor)
    .map((group) => ({
      id: group.planId,
      title: group.name,
      description: composed(`${K}.plans.description`, {
        count: countParam(group.workspaces),
        price: planPriceLabel(group.row),
      }),
      value: group.mrrMinor / 100,
      to: planEditPath(group.planId),
    }));
}
