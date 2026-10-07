import { GetModel } from "@antelopejs/interface-database-decorators";
import { type CreditNote, InvoiceModel } from "../../db";
import { CREDIT_NOTE_METADATA } from "../../operator-billing/credit-note-request";
import { AUTO_PRORATA_METADATA_KEY } from "../../stripe/webhook-handlers";

/** A credit note row read across workspaces: the workspace rides along. */
type CrossInstanceCreditNote = CreditNote & { _instance: string };

interface CreditNoteRowInstance {
  table: CrossInstanceCreditNote;
}

/** The row a data controller getter is computed for. */
export function creditNoteRow(self: unknown): CrossInstanceCreditNote {
  return (self as CreditNoteRowInstance).table;
}

/** Stripe's own reasons, worded with the module's reasons where they agree. */
const STRIPE_REASONS: Record<string, string> = {
  duplicate: "duplicate",
  fraudulent: "fraudulent",
  order_change: "order_change",
  product_unsatisfactory: "service_issue",
};

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Why a credit note was issued: the reason the operator picked, the automatic
 * flow that issued it, or Stripe's own reason; null when nothing says.
 *
 * @param row The credit note
 */
export function creditNoteReason(
  row: Pick<CreditNote, "metadata" | "reason">,
): string | null {
  const picked = metadataText(row.metadata, CREDIT_NOTE_METADATA.reason);
  if (picked) return picked;
  if (metadataText(row.metadata, AUTO_PRORATA_METADATA_KEY)) {
    return "prorated_cancellation";
  }
  return STRIPE_REASONS[row.reason] ?? null;
}

/**
 * The note shown under the reason: the operator's internal memo, else the
 * memo Stripe printed on the credit note.
 *
 * @param row The credit note
 */
export function creditNoteMemo(
  row: Pick<CreditNote, "metadata" | "memo">,
): string | null {
  return (
    metadataText(row.metadata, CREDIT_NOTE_METADATA.internalMemo) ??
    (row.memo || null)
  );
}

/**
 * The platform admin who issued the credit note; null for one the module
 * issued on its own (a cancellation's prorated refund, a money-back refund).
 *
 * @param row The credit note
 */
export function creditNoteIssuer(
  row: Pick<CreditNote, "metadata">,
): string | null {
  if (!metadataText(row.metadata, CREDIT_NOTE_METADATA.issuedBy)) return null;
  return metadataText(row.metadata, CREDIT_NOTE_METADATA.issuedByName) ?? "";
}

/**
 * The number of the invoice a credit note corrects.
 *
 * @param tenantId The credit note's workspace
 * @param invoiceId The invoice row
 */
export async function creditedInvoiceNumber(
  tenantId: string,
  invoiceId: string,
): Promise<string | null> {
  const invoice = await GetModel(InvoiceModel, tenantId).get(invoiceId);
  return invoice?.number ?? null;
}
