import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const invoiceLineInjectionsTableName = "saas_invoice_line_injections";

/**
 * Where a closing invoice stands.
 *
 * - `registered`: the task is durable, the draft is not yet known suspended.
 * - `suspended`: Stripe was read back with the draft at `auto_advance=false`.
 * - `finalizing`: every managed line was read back on the draft, and the
 *   fingerprint of what we finalize is recorded before asking Stripe to.
 * - `finalized`: Stripe was read back finalized with exactly that fingerprint.
 * - `needs_operator`: automation stops; the reason says why.
 */
export const INVOICE_LINE_INJECTION_STATES = [
  "registered",
  "suspended",
  "finalizing",
  "finalized",
  "needs_operator",
] as const;
export type InvoiceLineInjectionState =
  (typeof INVOICE_LINE_INJECTION_STATES)[number];

export type InvoiceLineInjectionSource = "webhook" | "discovery";

/** Durable recovery of one cycle invoice's usage lines, keyed by invoice id. */
@RegisterTable(invoiceLineInjectionsTableName, CORE_SCHEMA_NAME)
export class InvoiceLineInjection extends Table {
  /** The Stripe invoice id. */
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare tenantId: string;

  @Field("string")
  declare customerId: string;

  @Field("string")
  declare stripeSubscriptionId: string;

  @Field("string")
  declare currency: string;

  /** The paid-coverage window the providers bill, already clipped. */
  @Field("date")
  declare periodStart: Date;

  @Field("date")
  declare periodEnd: Date;

  @Field("string")
  declare source: InvoiceLineInjectionSource;

  /** The invoice.created event whose receipt this task takes over, if known. */
  @Field("string")
  declare eventId: string | null;

  @Index()
  @Field("string")
  declare state: InvoiceLineInjectionState;

  @Field("string")
  declare reason: string | null;

  /** Canonical description of the managed lines, set on entering `finalizing`. */
  @Field("string")
  declare fingerprint: string | null;

  @Field("string")
  declare revision: string;

  /** Token of the handler or worker currently allowed to act on Stripe. */
  @Field("string")
  declare leaseId: string | null;

  @Field("date")
  declare leaseExpiresAt: Date | null;

  @Field("date")
  declare nextAttemptAt: Date | null;

  @Field("number")
  declare attemptCount: number;

  @Field("string")
  declare lastError: string | null;

  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare updatedAt: Date;
}
