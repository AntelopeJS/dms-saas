import type {
  ComposedText,
  ComposedTextParam,
  IconTone,
  StatGroupItem,
} from "@antelopejs/interface-dms/base";
import {
  composed,
  countParam,
  moneyParam,
  sumList,
  valueText,
} from "../i18n/composed-text";
import { CREDIT_NOTE_METADATA } from "./credit-note-request";

/** An amount in one currency, in minor units. */
export interface MoneyFigure {
  amount: number;
  currency: string;
}

/**
 * One headline figure of a billing list, before it is written. Money is
 * listed per currency, the largest first: the first is the figure, the
 * others are noted before the detail.
 */
interface BillingFigure {
  id: string;
  icon: string;
  tone: IconTone;
  eyebrow: string;
  value: MoneyFigure[] | number;
  detail: ComposedText;
}

/** The figures a billing list shows above itself, as a `StatGroup` reads them. */
export interface BillingStats {
  items: StatGroupItem[];
}

const STATS = "saas.operator_billing.stats";

/** Currency a total with nothing in it is written in. */
const FALLBACK_STAT_CURRENCY = "eur";

const ISSUED_STATUS = "issued";
const VOID_STATUS = "void";
const BALANCE_TYPE = "credit_to_balance";

interface MoneyRow {
  amount: number;
  currency: string;
}

/** An open invoice: what it asks, what was paid, whether Stripe retries. */
export interface OpenInvoiceRow extends MoneyRow {
  amountPaid?: number | null;
  nextPaymentAttemptAt?: Date | null;
}

/** A paid invoice: what was collected on it. */
export interface PaidInvoiceRow extends MoneyRow {
  amountPaid?: number | null;
}

/** A credit note: how it was settled and who issued it. */
export interface CreditNoteRow extends MoneyRow {
  type: string;
  status: string;
  refundId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** The rows the invoice figures are computed from. */
export interface InvoiceStatsInput {
  open: OpenInvoiceRow[];
  paidThisMonth: PaidInvoiceRow[];
  creditNotesThisMonth: CreditNoteRow[];
  writtenOffThisYear: MoneyRow[];
}

/**
 * Sums amounts per currency, the largest total first. Nothing to sum gives a
 * zero in the fallback currency, so a figure always has a currency.
 *
 * @param rows Amounts in minor units with their currency
 */
export function totalsByCurrency(rows: readonly MoneyRow[]): MoneyFigure[] {
  const totals = new Map<string, number>();
  for (const { amount, currency } of rows) {
    const key = currency.toLowerCase();
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  if (totals.size === 0) {
    return [{ amount: 0, currency: FALLBACK_STAT_CURRENCY }];
  }
  return [...totals]
    .map(([currency, amount]) => ({ amount, currency }))
    .sort((left, right) => right.amount - left.amount);
}

/** Amounts in several currencies as one parameter: "€49.00 + $12.00". */
function moneyFigures(figures: readonly MoneyFigure[]): ComposedTextParam {
  const amounts = figures.map((figure) =>
    moneyParam(figure.amount, figure.currency),
  );
  return amounts.length === 1 ? amounts[0]! : sumList(amounts)!;
}

function detailOf(figure: BillingFigure): ComposedText {
  if (typeof figure.value === "number" || figure.value.length < 2)
    return figure.detail;
  return composed(`${STATS}.other_currencies`, {
    amounts: moneyFigures(figure.value.slice(1)),
    detail: figure.detail,
  });
}

function toStatItem(figure: BillingFigure): StatGroupItem {
  return {
    id: figure.id,
    icon: figure.icon,
    tone: figure.tone,
    eyebrow: `$${STATS}.${figure.eyebrow}`,
    value:
      typeof figure.value === "number"
        ? figure.value
        : valueText(moneyFigures(figure.value.slice(0, 1))),
    detail: detailOf(figure),
  };
}

const issued = (notes: readonly CreditNoteRow[]) =>
  notes.filter((note) => note.status === ISSUED_STATUS);

const refunded = (notes: readonly CreditNoteRow[]) =>
  issued(notes).filter((note) => !!note.refundId);

const isAutomatic = (note: CreditNoteRow) =>
  !note.metadata?.[CREDIT_NOTE_METADATA.issuedBy];

function amountDue(row: OpenInvoiceRow): MoneyRow {
  return {
    amount: Math.max(0, row.amount - (row.amountPaid ?? 0)),
    currency: row.currency,
  };
}

function collected(row: PaidInvoiceRow): MoneyRow {
  return { amount: row.amountPaid ?? row.amount, currency: row.currency };
}

function awaitingPayment(open: readonly OpenInvoiceRow[]): BillingFigure {
  return {
    id: "awaiting",
    icon: "i-ph-hourglass-medium",
    tone: "warning",
    eyebrow: "awaiting_payment",
    value: totalsByCurrency(open.map(amountDue)),
    detail: {
      key: `${STATS}.awaiting_payment_detail`,
      params: {
        count: countParam(open.length),
        retries: open.filter((row) => !!row.nextPaymentAttemptAt).length,
      },
    },
  };
}

function collectedThisMonth(paid: readonly PaidInvoiceRow[]): BillingFigure {
  return {
    id: "collected",
    icon: "i-ph-check-circle",
    tone: "success",
    eyebrow: "collected_this_month",
    value: totalsByCurrency(paid.map(collected)),
    detail: {
      key: `${STATS}.collected_this_month_detail`,
      params: { count: countParam(paid.length) },
    },
  };
}

function creditedThisMonth(notes: readonly CreditNoteRow[]): BillingFigure {
  const issuedNotes = issued(notes);
  return {
    id: "credited",
    icon: "i-ph-receipt-x",
    tone: "primary",
    eyebrow: "credited_this_month",
    value: totalsByCurrency(issuedNotes),
    detail: {
      key: `${STATS}.credited_this_month_detail`,
      params: {
        count: countParam(issuedNotes.length),
        refunded: moneyFigures(totalsByCurrency(refunded(notes))),
      },
    },
  };
}

function writtenOffThisYear(rows: readonly MoneyRow[]): BillingFigure {
  return {
    id: "written_off",
    icon: "i-ph-prohibit",
    tone: "error",
    eyebrow: "written_off_this_year",
    value: totalsByCurrency(rows),
    detail: {
      key: `${STATS}.written_off_this_year_detail`,
      params: { count: countParam(rows.length) },
    },
  };
}

/**
 * The invoices page's figures: what awaits payment, what was collected and
 * credited this month, what was written off this year.
 *
 * @param input The rows of each figure
 */
export function computeInvoiceStats(input: InvoiceStatsInput): BillingStats {
  return {
    items: [
      awaitingPayment(input.open),
      collectedThisMonth(input.paidThisMonth),
      creditedThisMonth(input.creditNotesThisMonth),
      writtenOffThisYear(input.writtenOffThisYear),
    ].map(toStatItem),
  };
}

function creditSplit(notes: readonly CreditNoteRow[]): BillingFigure {
  const issuedNotes = issued(notes);
  return {
    id: "credited",
    icon: "i-ph-receipt-x",
    tone: "primary",
    eyebrow: "credited_this_month",
    value: totalsByCurrency(issuedNotes),
    detail: {
      key: `${STATS}.credit_split_detail`,
      params: {
        balance: moneyFigures(
          totalsByCurrency(
            issuedNotes.filter((note) => note.type === BALANCE_TYPE),
          ),
        ),
        refunded: moneyFigures(totalsByCurrency(refunded(notes))),
      },
    },
  };
}

function refundedToCards(notes: readonly CreditNoteRow[]): BillingFigure {
  const refunds = refunded(notes);
  return {
    id: "refunded",
    icon: "i-ph-credit-card",
    tone: "neutral",
    eyebrow: "refunded_to_cards",
    value: totalsByCurrency(refunds),
    detail: {
      key: `${STATS}.refunded_to_cards_detail`,
      params: {
        count: countParam(refunds.length),
        automatic: refunds.filter(isAutomatic).length,
      },
    },
  };
}

function creditNoteCount(notes: readonly CreditNoteRow[]): BillingFigure {
  return {
    id: "count",
    icon: "i-ph-files",
    tone: "neutral",
    eyebrow: "credit_notes_this_month",
    value: notes.length,
    detail: {
      key: `${STATS}.credit_notes_this_month_detail`,
      params: {
        void: notes.filter((note) => note.status === VOID_STATUS).length,
      },
    },
  };
}

/**
 * The credit notes page's figures for this month: what was credited, split
 * between balance and refunds, what went back to cards, how many notes.
 *
 * @param notes The credit notes issued this month
 */
export function computeCreditNoteStats(
  notes: readonly CreditNoteRow[],
): BillingStats {
  return {
    items: [
      creditSplit(notes),
      refundedToCards(notes),
      creditNoteCount(notes),
    ].map(toStatItem),
  };
}

/** The first instant of the month `now` falls in, in UTC. */
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The first instant of the year `now` falls in, in UTC. */
export function startOfYear(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}
