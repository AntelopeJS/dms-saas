import type {
  KeyValueListItem,
  NavCardItem,
  StatGroupItem,
  TopListItem,
} from "@antelopejs/interface-dms/base";
import { BILLING_STATES, type PlanInterval } from "../db";
import type { ServerMessages } from "../i18n/server-messages";
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
const ENDING_SEPARATOR = " · ";

function money(messages: ServerMessages, total: ReportingTotal): string {
  return messages.money(total.amountMinor, total.currency);
}

/** "… · $1,200.00 in USD not counted": what the reporting total leaves out. */
function otherCurrenciesNote(
  messages: ServerMessages,
  total: ReportingTotal,
): string {
  if (total.otherCurrencies.length === 0) return "";
  const amounts = total.otherCurrencies
    .map((other) => messages.money(other.amountMinor, other.currency))
    .join(", ");
  return `${ENDING_SEPARATOR}${messages.t(`${K}.other_currencies`, { amounts })}`;
}

function namedEndings(
  messages: ServerMessages,
  endings: DatedWorkspace[],
  key: string,
): string {
  return endings
    .slice(0, NAMED_ENDINGS_SHOWN)
    .map((ending) =>
      messages.t(key, { name: ending.name, date: messages.day(ending.at) }),
    )
    .join(ENDING_SEPARATOR);
}

function mrrItem(
  messages: ServerMessages,
  summary: DirectorySummary,
  detail: string,
): StatGroupItem {
  return {
    id: "mrr",
    icon: "i-ph-currency-circle-dollar",
    tone: "primary",
    eyebrow: `$${K}.headline.mrr`,
    value: money(messages, summary.mrr),
    detail: `${detail}${otherCurrenciesNote(messages, summary.mrr)}`,
  };
}

/** The dashboard's headline figures: MRR, paying workspaces, trials. */
export function dashboardHeadline(
  messages: ServerMessages,
  summary: DirectorySummary,
): StatGroupItem[] {
  const arr = {
    ...summary.mrr,
    amountMinor: summary.mrr.amountMinor * MONTHS_PER_YEAR,
  };
  return [
    mrrItem(
      messages,
      summary,
      messages.t(`${K}.headline.arr`, { arr: money(messages, arr) }),
    ),
    {
      id: "paying",
      icon: "i-ph-buildings",
      eyebrow: `$${K}.headline.paying`,
      value: messages.t(`${K}.headline.paying_value`, {
        paying: summary.paying,
        total: summary.total,
      }),
      detail: messages.t(`${K}.headline.paying_detail`, {
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
      detail: messages.t(`${K}.headline.trials_detail`, {
        count: summary.trialsEnding.count,
      }),
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.trialsEnding),
    },
  ];
}

function pastDueDetail(
  messages: ServerMessages,
  summary: DirectorySummary,
): string {
  const { atRisk, firstSuspension } = summary.pastDue;
  const amount = money(messages, atRisk);
  return firstSuspension
    ? messages.t(`${W}.past_due_detail`, {
        amount,
        date: messages.day(firstSuspension),
      })
    : messages.t(`${W}.past_due_detail_no_suspension`, { amount });
}

/** The workspace list's headline: MRR, past due, endings to act on. */
export function workspacesHeadline(
  messages: ServerMessages,
  summary: DirectorySummary,
  complimentaryEnding: DatedWorkspace[],
): StatGroupItem[] {
  return [
    mrrItem(
      messages,
      summary,
      messages.t(`${W}.mrr_detail`, { count: summary.paying }),
    ),
    {
      id: "past_due",
      icon: "i-ph-warning-circle",
      tone: summary.pastDue.count > 0 ? "error" : "muted",
      eyebrow: `$${W}.past_due`,
      value: summary.pastDue.count,
      detail: pastDueDetail(messages, summary),
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
        namedEndings(messages, complimentaryEnding, `${W}.named_ending`) ||
        messages.t(`${W}.none_this_week`),
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.complimentaryEnding),
    },
    {
      id: "trials_ending",
      icon: "i-ph-hourglass-medium",
      tone: "info",
      eyebrow: `$${W}.trials_ending`,
      value: summary.trialsEnding.count,
      detail: messages.t(`${W}.trials_ending_detail`, {
        amount: money(messages, summary.trialsEnding.thenMrr),
      }),
      to: workspacesViewPath(WORKSPACE_VIEW_IDS.trialsEnding),
    },
  ];
}

function pastDueCard(
  messages: ServerMessages,
  summary: DirectorySummary,
): NavCardItem {
  return {
    id: "past_due",
    icon: "i-ph-warning-circle",
    iconTone: "error",
    title: messages.t(`${K}.attention.past_due`, {
      count: summary.pastDue.count,
    }),
    description: pastDueDetail(messages, summary),
    to: workspacesTabPath("past_due"),
  };
}

function complimentaryCard(
  messages: ServerMessages,
  endings: DatedWorkspace[],
): NavCardItem {
  return {
    id: "complimentary_ending",
    icon: "i-ph-gift",
    iconTone: "warning",
    title: messages.t(`${K}.attention.complimentary_ending`, {
      count: endings.length,
    }),
    description: namedEndings(messages, endings, `${K}.attention.named_ending`),
    to: workspacesViewPath(WORKSPACE_VIEW_IDS.complimentaryEnding),
  };
}

function migrationsCard(
  messages: ServerMessages,
  migrations: MigrationAttention,
): NavCardItem {
  return {
    id: "migrations",
    icon: "i-ph-arrows-clockwise",
    iconTone: "error",
    title: messages.t(`${K}.attention.migrations`, { count: migrations.count }),
    description: messages.t(`${K}.attention.migrations_detail`, {
      from: migrations.firstFromPlan,
      to: migrations.firstToPlan,
      failed: migrations.firstFailed,
      total: migrations.firstTotal,
    }),
    to: PLAN_MIGRATIONS_PAGE_PATH,
  };
}

function openInvoicesCard(
  messages: ServerMessages,
  open: OpenInvoicesAttention,
): NavCardItem {
  return {
    id: "open_invoices",
    icon: "i-ph-receipt",
    iconTone: "warning",
    title: messages.t(`${K}.attention.open_invoices`, { count: open.count }),
    description: messages.t(`${K}.attention.open_invoices_detail`, {
      amount: money(messages, open.awaiting),
    }),
    to: `${INVOICES_PAGE_PATH}?tab=open`,
  };
}

/** One card per queue that holds something; an empty queue shows nothing. */
export function attentionCards(
  messages: ServerMessages,
  inputs: AttentionInputs,
): NavCardItem[] {
  const queues: Array<[number, () => NavCardItem]> = [
    [inputs.summary.pastDue.count, () => pastDueCard(messages, inputs.summary)],
    [
      inputs.complimentaryEnding.length,
      () => complimentaryCard(messages, inputs.complimentaryEnding),
    ],
    [
      inputs.migrations.count,
      () => migrationsCard(messages, inputs.migrations),
    ],
    [
      inputs.openInvoices.count,
      () => openInvoicesCard(messages, inputs.openInvoices),
    ],
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

function planPriceLabel(messages: ServerMessages, row: DirectoryRow): string {
  const price = messages.money(
    row.planUnitAmountMinor ?? 0,
    row.currency ?? "",
  );
  const interval = messages.t(
    `saas.workspaces.interval.${row.planInterval as PlanInterval}`,
  );
  const key = row.planBillingMode === "seat" ? "price_per_seat" : "price_flat";
  return messages.t(`saas.workspaces.plan_cell.${key}`, { price, interval });
}

/** Plans ranked by the MRR they bring, in the reporting currency. */
export function plansByMrrItems(
  messages: ServerMessages,
  rows: DirectoryRow[],
  currency: string,
): TopListItem[] {
  return groupByPlan(rows, currency)
    .sort((left, right) => right.mrrMinor - left.mrrMinor)
    .map((group) => ({
      id: group.planId,
      title: group.name,
      description: messages.t(`${K}.plans.description`, {
        count: group.workspaces,
        price: planPriceLabel(messages, group.row),
      }),
      value: group.mrrMinor / 100,
      to: planEditPath(group.planId),
    }));
}
