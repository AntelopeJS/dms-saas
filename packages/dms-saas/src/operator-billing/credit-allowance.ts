import type { CreditNote, InvoiceStatus } from "../db";

/**
 * How a credit note reaches the customer. A paid invoice is credited to the
 * customer's balance (deducted from the next invoice) or refunded to the card;
 * an open one is credited before payment, which lowers what it asks.
 */
export const CREDIT_MODES = [
  "credit_to_balance",
  "refund",
  "reduce_amount_due",
] as const;

export type CreditMode = (typeof CREDIT_MODES)[number];

/** Why an invoice cannot be credited, shown in place of the credit form. */
export type CreditBlockReason =
  | "draft"
  | "void"
  | "uncollectible"
  | "fully_credited";

const MODES_BY_STATUS: Partial<Record<InvoiceStatus, readonly CreditMode[]>> = {
  paid: ["credit_to_balance", "refund"],
  open: ["reduce_amount_due"],
};

const BLOCK_REASON_BY_STATUS: Record<string, CreditBlockReason> = {
  draft: "draft",
  void: "void",
  uncollectible: "uncollectible",
};

const ISSUED_CREDIT_NOTE_STATUS = "issued";

/** The statuses whose invoices can be credited: paid and open. */
export const CREDITABLE_INVOICE_STATUSES = Object.keys(
  MODES_BY_STATUS,
) as InvoiceStatus[];

/** What crediting an invoice depends on: its status and its total. */
export interface CreditableInvoice {
  status: string;
  total: number;
}

/** What an invoice still allows to credit, and how. */
export interface CreditAllowance {
  /** Sum of the credit notes already issued against the invoice. */
  credited: number;
  /** Most that can still be credited: the total less what was credited. */
  creditable: number;
  /** The modes the invoice's status allows; empty when it is blocked. */
  modes: readonly CreditMode[];
  blockReason: CreditBlockReason | null;
}

/** Sum of the issued credit notes, a voided one giving nothing back. */
export function sumIssuedCredits(
  creditNotes: readonly Pick<CreditNote, "amount" | "status">[],
): number {
  return creditNotes
    .filter((note) => note.status === ISSUED_CREDIT_NOTE_STATUS)
    .reduce((total, note) => total + note.amount, 0);
}

/**
 * What can still be credited on an invoice: only paid and open invoices, up
 * to their total less the credit notes already issued against them.
 *
 * @param invoice The invoice row
 * @param credited Sum of the credit notes already issued against it
 */
export function creditAllowance(
  invoice: CreditableInvoice,
  credited: number,
): CreditAllowance {
  const creditable = Math.max(0, invoice.total - credited);
  const statusModes = MODES_BY_STATUS[invoice.status as InvoiceStatus] ?? [];
  const blockReason = resolveBlockReason(invoice.status, creditable);
  return {
    credited,
    creditable: blockReason ? 0 : creditable,
    modes: blockReason ? [] : statusModes,
    blockReason,
  };
}

function resolveBlockReason(
  status: string,
  creditable: number,
): CreditBlockReason | null {
  if (!MODES_BY_STATUS[status as InvoiceStatus]) {
    return BLOCK_REASON_BY_STATUS[status] ?? "void";
  }
  return creditable > 0 ? null : "fully_credited";
}
