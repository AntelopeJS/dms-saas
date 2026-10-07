import type { Invoice } from "../db";
import { MS_PER_DAY } from "../utils/time";
import type { DirectoryRow } from "./directory-summary";
import { type ReportingTotal, sumInReportingCurrency } from "./normalised-mrr";

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
}

/** Cancellations over a period and the MRR they took away. */
export interface ChurnFigures {
  /** Lost MRR over the MRR the period started with, in percent. */
  rate: number;
  cancellations: number;
  lost: ReportingTotal;
}

const DEFAULT_PERIOD_DAYS = 30;
// Up to a quarter, one bar per day reads; beyond it, one per month.
const DAILY_BUCKETS_MAX_DAYS = 92;
const MINOR_UNITS_PER_UNIT = 100;
const PERCENT = 100;
const DAY_KEY_LENGTH = 10;
const MONTH_KEY_LENGTH = 7;
const COLLECTED_SERIES = "$saas.dashboard.paid_invoices.collected";
const CREDITED_SERIES = "$saas.dashboard.paid_invoices.credited";
const CREDIT_NOTE_DOCUMENT = "credit_note";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The range a request names, the last 30 days when it names none. */
export function parsePeriod(
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

/** The comparison range a request names, if any. */
export function parseComparison(
  from: unknown,
  to: unknown,
): PeriodRange | null {
  const start = parseDate(from);
  const end = parseDate(to);
  return start && end ? { from: start, to: end } : null;
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
  return (document.total || document.amount) / MINOR_UNITS_PER_UNIT;
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
 */
export function paidInvoicesChart(
  documents: Invoice[],
  range: PeriodRange,
  comparison: PeriodRange | null,
  reportingCurrency: string,
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
  const previousValue = comparison
    ? sumMajorUnits(collectedIn(documents, comparison, reportingCurrency))
    : undefined;
  return {
    value,
    previousValue,
    delta:
      previousValue === undefined
        ? undefined
        : percentChange(value, previousValue),
    series: [
      { name: COLLECTED_SERIES, data: collected },
      { name: CREDITED_SERIES, data: credited },
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
      amountMinor: row.previousMrrMinor ?? 0,
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
