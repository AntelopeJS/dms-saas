import type { CellSubline, ComposedText } from "@antelopejs/interface-dms/base";
import type { Invoice } from "../../db";
import { composed, dateParam } from "../../i18n/composed-text";

/** The invoice fields its status line is written from. */
export type InvoiceStatusRow = Pick<
  Invoice,
  | "status"
  | "attemptCount"
  | "nextPaymentAttemptAt"
  | "dueAt"
  | "autoFinalizesAt"
>;

const SUB_STATE = "saas.operator_billing.invoices.sub_state";
const MIN_SEATS_SHOWN = 2;

const day = (date: Date) => dateParam(date, "day");

function openDetail(row: InvoiceStatusRow): CellSubline | null {
  if (row.attemptCount) {
    return row.nextPaymentAttemptAt
      ? {
          text: composed(`${SUB_STATE}.retry`, {
            date: day(row.nextPaymentAttemptAt),
          }),
          tone: "error",
        }
      : { text: `$${SUB_STATE}.retries_over`, tone: "error" };
  }
  if (!row.dueAt) return null;
  return { text: composed(`${SUB_STATE}.due`, { date: day(row.dueAt) }) };
}

type StatusDetail = (
  row: InvoiceStatusRow,
  replacedBy: string | null,
) => CellSubline | null;

const STATUS_DETAILS: Record<string, StatusDetail> = {
  draft: (row) =>
    row.autoFinalizesAt
      ? {
          text: composed(`${SUB_STATE}.finalises`, {
            date: day(row.autoFinalizesAt),
          }),
        }
      : null,
  open: (row) => openDetail(row),
  void: (_row, replacedBy) =>
    replacedBy
      ? { text: composed(`${SUB_STATE}.replaced_by`, { number: replacedBy }) }
      : null,
  uncollectible: () => ({ text: `$${SUB_STATE}.written_off`, tone: "error" }),
};

/**
 * What Stripe is doing about an invoice, under its status: "Payment failed ·
 * retry Oct 2" in red, "Finalises Oct 1", "Replaced by INV-0936".
 *
 * @param row The invoice
 * @param replacedBy The number of the invoice that replaced a void one
 */
export function invoiceStatusDetail(
  row: InvoiceStatusRow,
  replacedBy: string | null,
): CellSubline | null {
  return STATUS_DETAILS[row.status]?.(row, replacedBy) ?? null;
}

/** The workspace's plan under its name, with the seats an invoice bills. */
export function invoiceWorkspaceDetail(
  planName: string | null,
  seats: number | null,
): ComposedText | string | null {
  if (!planName) return null;
  if (!seats || seats < MIN_SEATS_SHOWN) return planName;
  return composed("saas.operator_billing.cells.plan_seats", {
    plan: planName,
    seats,
  });
}
