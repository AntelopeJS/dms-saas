import {
  Context,
  Controller,
  Get,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type {
  ActivityFeedItem,
  KeyValueListItem,
  NavCardItem,
  StatGroupItem,
  TopListItem,
} from "@antelopejs/interface-dms/base";
import { getReportingCurrency } from "../../config";
import { type Invoice, InvoiceModel, PlanMigrationModel } from "../../db";
import { buildActivityFeed, parseActivityKind } from "../../metrics/activity";
import {
  type DirectoryRow,
  loadDirectoryRows,
  nameWorkspaces,
  summariseDirectory,
} from "../../metrics/directory-summary";
import {
  attentionCards,
  dashboardHeadline,
  type MigrationAttention,
  type OpenInvoicesAttention,
  plansByMrrItems,
  workspacesByStatusItems,
} from "../../metrics/headline-items";
import { sumInReportingCurrency } from "../../metrics/normalised-mrr";
import {
  type ChartCardPayload,
  churnOver,
  paidInvoicesChart,
  readPeriodQuery,
} from "../../metrics/revenue";
import { workspaceDetailPath } from "../../pages/platform/paths";
import { migrationTotals } from "../../plans/migration-detail";
import { MS_PER_DAY } from "../../utils/time";
import { loadActivitySources } from "../../metrics/activity-sources";
import type { ItemsPayload } from "./block-payloads";

/** What a `KpiCard` reads from its route. */
interface KpiPayload {
  value: number;
  previousValue?: number;
  delta?: number;
}

const OPEN_STATUS = "open";
// Paid invoices are filtered on their issue date, which an invoice paid late
// precedes: the window reaches back far enough to catch it.
const LATE_PAYMENT_LOOKBACK_DAYS = 90;
const ACTIVITY_LIMIT = 8;
const PERCENT = 100;

/** The migrations the migrations list shows as needing an operator. */
async function loadAttentionMigrations(): Promise<MigrationAttention> {
  const migrations =
    await GetModel(PlanMigrationModel).findByStage("needs_attention");
  const [first] = migrations;
  const totals = first ? migrationTotals(first) : null;
  return {
    count: migrations.length,
    firstFromPlan: first?.fromPlanName ?? "—",
    firstToPlan: first?.toPlanName ?? "—",
    firstFailed: totals?.notMoved ?? 0,
    firstTotal: totals?.captured ?? 0,
  };
}

async function loadOpenInvoices(
  currency: string,
): Promise<OpenInvoicesAttention> {
  const open: Invoice[] = await GetModel(InvoiceModel, CROSS_INSTANCE)
    .table.getAll(OPEN_STATUS, "status")
    .run();
  return {
    count: open.length,
    awaiting: sumInReportingCurrency(
      open.map((invoice) => ({
        amountMinor: invoice.total,
        currency: invoice.currency,
      })),
      currency,
    ),
  };
}

async function loadSettledDocuments(since: Date): Promise<Invoice[]> {
  const cutoff = new Date(
    since.getTime() - LATE_PAYMENT_LOOKBACK_DAYS * MS_PER_DAY,
  );
  return GetModel(InvoiceModel, CROSS_INSTANCE)
    .table.getAll(["paid", "issued"], "status")
    .filter((row) => row.key("issuedAt").ge(cutoff))
    .run();
}

function earliestStart(...ranges: Array<{ from: Date } | null>): Date {
  return ranges
    .filter((range): range is { from: Date } => range !== null)
    .reduce(
      (first, range) => (range.from < first ? range.from : first),
      new Date(),
    );
}

/** Platform-wide figures of the back-office dashboard. */
export class SaasDashboardController extends Controller("/api/saas/dashboard") {
  private async summary(): Promise<{ rows: DirectoryRow[]; currency: string }> {
    return {
      rows: await loadDirectoryRows(),
      currency: getReportingCurrency(),
    };
  }

  @Get("/headline")
  async headline(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<StatGroupItem>> {
    const { rows, currency } = await this.summary();
    const summary = summariseDirectory(rows, new Date(), currency);
    return { items: dashboardHeadline(summary) };
  }

  @Get("/attention")
  async attention(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<NavCardItem>> {
    const { rows, currency } = await this.summary();
    const summary = summariseDirectory(rows, new Date(), currency);
    const [complimentaryEnding, migrations, openInvoices] = await Promise.all([
      nameWorkspaces(summary.complimentaryEnding),
      loadAttentionMigrations(),
      loadOpenInvoices(currency),
    ]);
    return {
      items: attentionCards({
        summary,
        complimentaryEnding,
        migrations,
        openInvoices,
      }),
    };
  }

  @Get("/churn")
  async churn(
    @AuthOwnerOnly() _user: User,
    @Context() ctx: RequestContext,
  ): Promise<KpiPayload> {
    const { rows, currency } = await this.summary();
    const mrr = summariseDirectory(rows, new Date(), currency).mrr;
    const { range, comparison } = readPeriodQuery(ctx.url.searchParams);
    const current = churnOver(rows, range, mrr);
    if (!comparison) return { value: current.rate };
    const previous = churnOver(rows, comparison, mrr);
    return {
      value: current.rate,
      previousValue: previous.rate,
      delta:
        previous.rate === 0
          ? undefined
          : ((current.rate - previous.rate) / previous.rate) * PERCENT,
    };
  }

  @Get("/paid-invoices")
  async paidInvoices(
    @AuthOwnerOnly() _user: User,
    @Context() ctx: RequestContext,
  ): Promise<ChartCardPayload> {
    const { range, comparison, comparisonMode } = readPeriodQuery(
      ctx.url.searchParams,
    );
    const documents = await loadSettledDocuments(
      earliestStart(range, comparison),
    );
    return paidInvoicesChart(
      documents,
      range,
      comparison,
      getReportingCurrency(),
      comparisonMode,
    );
  }

  @Get("/workspaces-by-status")
  async workspacesByStatus(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<KeyValueListItem>> {
    const { rows, currency } = await this.summary();
    return {
      items: workspacesByStatusItems(
        summariseDirectory(rows, new Date(), currency),
      ),
    };
  }

  @Get("/plans-by-mrr")
  async plansByMrr(
    @AuthOwnerOnly() _user: User,
  ): Promise<ItemsPayload<TopListItem>> {
    const { rows, currency } = await this.summary();
    return { items: plansByMrrItems(rows, currency) };
  }

  @Get("/activity")
  async activity(
    @AuthOwnerOnly() _user: User,
    @Parameter("kind", "query") kind: unknown,
  ): Promise<ItemsPayload<ActivityFeedItem>> {
    const sources = await loadActivitySources(null, ACTIVITY_LIMIT);
    return {
      items: buildActivityFeed(sources, {
        kind: parseActivityKind(kind),
        limit: ACTIVITY_LIMIT,
        linkOf: workspaceDetailPath,
        now: new Date(),
      }),
    };
  }
}
