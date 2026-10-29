import type { Invoice } from "../db";
import { MS_PER_DAY } from "../utils/time";
import type { DirectoryRow } from "./directory-summary";
import { type ReportingTotal, sumInReportingCurrency } from "./normalised-mrr";
import { fromMinorUnits } from "../utils/money";

/** A date range a `PeriodSelector` sends (`from`, `to`). */
export interface PeriodRange {
  from: Date;
  to: Date;
}

/** One point of a chart series. */
export interface SeriesPoint {
  x: string;
  y: number;
}

/** A named chart series; the name is an i18n key with `$`. */
export interface ChartSeries {
  name: string;
  data: SeriesPoint[];
}

/** What a `ChartCard` reads from its `fetchUrl`. */
export interface ChartCardPayload {
  value: number;
  previousValue?: number;
  delta?: number;
  series: ChartSeries[];
  /**
   * The collected series of the comparison window, drawn over the current
   * one: each bucket sits on the current bucket at the same position.
   */
  comparisonSeries?: ChartSeries[];
}

/** The period a `PeriodSelector` sends with a request, read once. */
export interface PeriodQuery {
  range: PeriodRange;
  /** `null` when no comparison is selected (`Sans comparaison`). */
  comparison: PeriodRange | null;
  /** The comparison the selector names: `previous-period`, `previous-year`… */
  comparisonMode: string | null;
}

/** What a `KpiCard` reads from its `fetchUrl`. */
export interface KpiCardPayload {
  value: number;
  previousValue?: number;
  delta?: number;
}

/** Cancellations over a period and the MRR they took away. */
export interface ChurnFigures {
  /** Lost MRR over the MRR the period started with, in percent. */
  rate: number;
  cancellations: number;
  lost: ReportingTotal;
}

const DEFAULT_PERIOD_DAYS = 30;
/** Up to a quarter, one bar per day reads; beyond it, one per month. */
const DAILY_BUCKETS_MAX_DAYS = 92;
const PERCENT = 100;
const DAY_KEY_LENGTH = 10;
const MONTH_KEY_LENGTH = 7;
const COLLECTED_SERIES = "$saas.dashboard.paid_invoices.collected";
const CREDITED_SERIES = "$saas.dashboard.paid_invoices.credited";
const CREDIT_NOTE_DOCUMENT = "credit_note";
/** What a `PeriodSelector` sends as `comparison` when none is chosen. */
const NO_COMPARISON = "none";
const COMPARISON_SERIES: Record<string, string> = {
  "previous-period": "$saas.dashboard.paid_invoices.collected_previous_period",
  "previous-year": "$saas.dashboard.paid_invoices.collected_previous_year",
};
/** A custom comparison window has no name of its own. */
const CUSTOM_COMPARISON_SERIES =
  "$saas.dashboard.paid_invoices.collected_compared";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The range a request names, the last 30 days when it names none. */
function parsePeriod(
  from: unknown,
  to: unknown,
  now = new Date(),
): PeriodRange {
  const end = parseDate(to) ?? now;
  const start =
    parseDate(from) ??
    new Date(end.getTime() - DEFAULT_PERIOD_DAYS * MS_PER_DAY);
  return { from: start, to: end };
}

/**
 * The comparison range a request names, if any. `comparison` is the mode the
 * selector sends with it: `none` turns the comparison off whatever the range.
 */
export function parseComparison(
  from: unknown,
  to: unknown,
  comparison?: unknown,
): PeriodRange | null {
  if (comparison === NO_COMPARISON) return null;
  const start = parseDate(from);
  const end = parseDate(to);
  return start && end ? { from: start, to: end } : null;
}

/**
 * The period and comparison a `PeriodSelector` adds to a URL: `from` / `to`,
 * `compareFrom` / `compareTo` and `comparison`.
 */
export function readPeriodQuery(
  query: URLSearchParams,
  now = new Date(),
): PeriodQuery {
  const comparisonMode = query.get("comparison");
  return {
    range: parsePeriod(query.get("from"), query.get("to"), now),
    comparison: parseComparison(
      query.get("compareFrom"),
      query.get("compareTo"),
      comparisonMode,
    ),
    comparisonMode,
  };
}

function isWithin(date: Date, range: PeriodRange): boolean {
  return date >= range.from && date <= range.to;
}

function bucketLength(range: PeriodRange): number {
  const days = (range.to.getTime() - range.from.getTime()) / MS_PER_DAY;
  return days <= DAILY_BUCKETS_MAX_DAYS ? DAY_KEY_LENGTH : MONTH_KEY_LENGTH;
}

function bucketKeys(range: PeriodRange, length: number): string[] {
  const keys = new Set<string>();
  for (
    let time = range.from.getTime();
    time <= range.to.getTime();
    time += MS_PER_DAY
  ) {
    keys.add(new Date(time).toISOString().slice(0, length));
  }
  keys.add(range.to.toISOString().slice(0, length));
  return [...keys];
}

function documentDate(document: Invoice): Date {
  return new Date(document.paidAt ?? document.issuedAt);
}

function inReportingCurrency(document: Invoice, currency: string): boolean {
  return document.currency.toUpperCase() === currency;
}

function majorUnitsOf(document: Invoice): number {
  return fromMinorUnits(document.total, document.currency);
}

function sumMajorUnits(documents: Invoice[]): number {
  return documents.reduce((sum, document) => sum + majorUnitsOf(document), 0);
}

function seriesOf(
  documents: Invoice[],
  keys: string[],
  length: number,
): SeriesPoint[] {
  const totals = new Map(keys.map((bucket) => [bucket, 0]));
  for (const document of documents) {
    const bucket = documentDate(document).toISOString().slice(0, length);
    totals.set(bucket, (totals.get(bucket) ?? 0) + majorUnitsOf(document));
  }
  return keys.map((bucket) => ({ x: bucket, y: totals.get(bucket) ?? 0 }));
}

/**
 * The comparison window's points laid on the current buckets by position: a
 * previous year's day draws under this year's same day, not a year away on
 * the axis. Buckets beyond the current ones (a leap day) are left out.
 */
function alignedSeriesOf(
  documents: Invoice[],
  comparison: PeriodRange,
  currentKeys: string[],
  length: number,
): SeriesPoint[] {
  const points = seriesOf(documents, bucketKeys(comparison, length), length);
  return currentKeys.map((bucket, index) => ({
    x: bucket,
    y: points[index]?.y ?? 0,
  }));
}

function comparisonSeriesName(comparison: unknown): string {
  return typeof comparison === "string"
    ? (COMPARISON_SERIES[comparison] ?? CUSTOM_COMPARISON_SERIES)
    : CUSTOM_COMPARISON_SERIES;
}

function totalOf(points: SeriesPoint[]): number {
  return points.reduce((sum, point) => sum + point.y, 0);
}

function collectedIn(
  documents: Invoice[],
  range: PeriodRange,
  currency: string,
): Invoice[] {
  return documents.filter(
    (document) =>
      document.documentType !== CREDIT_NOTE_DOCUMENT &&
      document.status === "paid" &&
      inReportingCurrency(document, currency) &&
      isWithin(documentDate(document), range),
  );
}

function creditedIn(
  documents: Invoice[],
  range: PeriodRange,
  currency: string,
): Invoice[] {
  return documents.filter(
    (document) =>
      document.documentType === CREDIT_NOTE_DOCUMENT &&
      document.status === "issued" &&
      inReportingCurrency(document, currency) &&
      isWithin(documentDate(document), range),
  );
}

function percentChange(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / previous) * PERCENT;
}

/**
 * Money collected (paid invoices) and credited (credit notes) over the range,
 * in the reporting currency, per day up to a quarter and per month beyond.
 * With a comparison window, its collected money is the previous value and a
 * series named after `comparisonMode` (`previous-period`, `previous-year`).
 */
export function paidInvoicesChart(
  documents: Invoice[],
  range: PeriodRange,
  comparison: PeriodRange | null,
  reportingCurrency: string,
  comparisonMode?: unknown,
): ChartCardPayload {
  const length = bucketLength(range);
  const keys = bucketKeys(range, length);
  const collected = seriesOf(
    collectedIn(documents, range, reportingCurrency),
    keys,
    length,
  );
  const credited = seriesOf(
    creditedIn(documents, range, reportingCurrency),
    keys,
    length,
  );
  const value = totalOf(collected);
  const series = [
    { name: COLLECTED_SERIES, data: collected },
    { name: CREDITED_SERIES, data: credited },
  ];
  if (!comparison) return { value, series };
  const collectedBefore = collectedIn(documents, comparison, reportingCurrency);
  const previousValue = sumMajorUnits(collectedBefore);
  return {
    value,
    previousValue,
    delta: percentChange(value, previousValue),
    series,
    comparisonSeries: [
      {
        name: comparisonSeriesName(comparisonMode),
        data: alignedSeriesOf(collectedBefore, comparison, keys, length),
      },
    ],
  };
}

/**
 * Workspaces cancelled over the range and the MRR they paid before. The rate
 * divides that loss by the MRR the period started with, taken as today's MRR
 * plus what was lost: the module keeps no MRR history to read it from.
 */
export function churnOver(
  rows: DirectoryRow[],
  range: PeriodRange,
  currentMrr: ReportingTotal,
): ChurnFigures {
  const cancelled = rows.filter(
    (row) =>
      row.billingState === "cancelled" &&
      !!row.stateSince &&
      isWithin(new Date(row.stateSince), range),
  );
  const lost = sumInReportingCurrency(
    cancelled.map((row) => ({
      amountMinor: row.previousMrrMinor,
      currency: row.currency ?? "",
    })),
    currentMrr.currency,
  );
  const base = currentMrr.amountMinor + lost.amountMinor;
  return {
    rate: base === 0 ? 0 : (lost.amountMinor / base) * PERCENT,
    cancellations: cancelled.length,
    lost,
  };
}

/**
 * The churn rate over the period and, with a comparison window, the rate
 * over that window and how far it moved: nothing to compare without one.
 */
export function churnKpi(
  rows: DirectoryRow[],
  period: PeriodQuery,
  currentMrr: ReportingTotal,
): KpiCardPayload {
  const value = churnOver(rows, period.range, currentMrr).rate;
  if (!period.comparison) return { value };
  const previousValue = churnOver(rows, period.comparison, currentMrr).rate;
  return {
    value,
    previousValue,
    delta: percentChange(value, previousValue),
  };
}
