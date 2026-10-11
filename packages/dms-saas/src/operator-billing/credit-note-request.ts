import type Stripe from "stripe";
import { z } from "zod";
import { CREDIT_MODES, type CreditMode } from "./credit-allowance";

/** Why an operator credits an invoice, as the credit notes list words it. */
export const CREDIT_REASONS = [
  "service_issue",
  "billing_error",
  "duplicate",
  "goodwill",
  "fraudulent",
  "other",
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

/**
 * Metadata a credit note carries in Stripe, read back by the mirror: who
 * issued it (none for the automatic ones), why, and the operator's memo,
 * which Stripe never shows the customer (its own `memo` it prints).
 */
export const CREDIT_NOTE_METADATA = {
  issuedBy: "saas_issued_by",
  issuedByName: "saas_issued_by_name",
  reason: "saas_reason",
  internalMemo: "saas_internal_memo",
} as const;

/** Stripe keeps a metadata value to this many characters. */
const INTERNAL_MEMO_MAX_LENGTH = 500;

const STRIPE_REASON: Partial<
  Record<CreditReason, Stripe.CreditNoteCreateParams.Reason>
> = {
  service_issue: "product_unsatisfactory",
  billing_error: "order_change",
  duplicate: "duplicate",
  fraudulent: "fraudulent",
};

const AMOUNT_FIELD_BY_MODE: Partial<
  Record<CreditMode, "credit_amount" | "refund_amount">
> = {
  credit_to_balance: "credit_amount",
  refund: "refund_amount",
};

/** The body of a credit note request. Amounts are in minor units. */
export const issueCreditNoteBodySchema = z.object({
  invoiceId: z.string().min(1),
  amount: z
    .number()
    .int()
    .positive({ message: "$saas.errors.credit_note.amount_positive" }),
  mode: z.enum(CREDIT_MODES),
  reason: z.enum(CREDIT_REASONS),
  memo: z
    .string()
    .trim()
    .max(INTERNAL_MEMO_MAX_LENGTH, {
      message: "$saas.errors.credit_note.memo_too_long",
    })
    .optional(),
  /** Set once per dialog: a retried click lands on the same credit note. */
  requestId: z.string().min(1).max(100),
});

export type IssueCreditNoteBody = z.infer<typeof issueCreditNoteBodySchema>;

/** Who issues the credit note. */
export interface CreditNoteIssuer {
  _id: string;
  name?: string | null;
  email?: string | null;
}

function buildMetadata(
  body: IssueCreditNoteBody,
  issuer: CreditNoteIssuer,
): Record<string, string> {
  const metadata: Record<string, string> = {
    [CREDIT_NOTE_METADATA.issuedBy]: issuer._id,
    [CREDIT_NOTE_METADATA.issuedByName]: issuer.name || issuer.email || "",
    [CREDIT_NOTE_METADATA.reason]: body.reason,
  };
  if (body.memo) metadata[CREDIT_NOTE_METADATA.internalMemo] = body.memo;
  return metadata;
}

/**
 * The Stripe credit note a request creates: the whole amount credited to the
 * balance, refunded, or taken off what an open invoice asks.
 *
 * @param stripeInvoiceId The Stripe invoice credited
 * @param body The validated request
 * @param issuer The platform admin issuing it
 */
export function buildCreditNoteParams(
  stripeInvoiceId: string,
  body: IssueCreditNoteBody,
  issuer: CreditNoteIssuer,
): Stripe.CreditNoteCreateParams {
  const params: Stripe.CreditNoteCreateParams = {
    invoice: stripeInvoiceId,
    amount: body.amount,
    metadata: buildMetadata(body, issuer),
  };
  const reason = STRIPE_REASON[body.reason];
  if (reason) params.reason = reason;
  const amountField = AMOUNT_FIELD_BY_MODE[body.mode];
  if (amountField) params[amountField] = body.amount;
  return params;
}
