import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const invoicesTableName = "invoices";

export const INVOICE_STATUSES = [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type BillingDocumentType = "invoice" | "credit_note";

export type BillingDocumentStatus = InvoiceStatus | "issued";

export interface InvoiceMetadata {
  planId?: string;
  planName?: string;
  [key: string]: unknown;
}

export interface InvoiceLine {
  description: string;
  quantity: number | null;
  amount: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}

/** Tenant invoice mirrored from the configured payment provider. */
@RegisterTable(invoicesTableName, TENANT_SCHEMA_NAME)
export class Invoice extends Table {
  @Field("string")
  declare _id: string;

  @Index({ crossInstance: true })
  @Field("string")
  declare documentType: BillingDocumentType;

  @Index()
  @Field("string")
  declare stripeInvoiceId: string;

  @Index()
  @Field("string")
  declare stripeCreditNoteId: string | null;

  @Field("string")
  declare number: string | null;

  @Field("string")
  declare parentInvoiceNumber: string | null;

  @Field("number")
  declare amount: number;

  @Field("number")
  declare subtotal: number;

  @Field("number")
  declare tax: number;

  @Field("number")
  declare total: number;

  /** What the customer paid on the invoice so far, in minor units. */
  @Field("number")
  declare amountPaid?: number | null;

  /** Payment attempts Stripe made, its automatic retries included. */
  @Field("number")
  declare attemptCount?: number | null;

  /** When Stripe charges the card next; null once it stopped retrying. */
  @Field("date")
  declare nextPaymentAttemptAt?: Date | null;

  /** When an invoice sent for manual payment falls due. */
  @Field("date")
  declare dueAt?: Date | null;

  /** When Stripe finalises a draft invoice on its own. */
  @Field("date")
  declare autoFinalizesAt?: Date | null;

  /** The Stripe invoice that replaced this one through a revision. */
  @Field("string")
  declare latestRevisionStripeId?: string | null;

  @Field("string")
  declare currency: string;

  @Field("date")
  declare periodStart: Date | null;

  @Field("date")
  declare periodEnd: Date | null;

  @Field("any")
  declare lines: InvoiceLine[];

  @Index({ crossInstance: true })
  @Field("string")
  declare status: BillingDocumentStatus;

  @Field("string")
  declare creditNoteReason: string | null;

  @Field("string")
  declare creditNoteType: string | null;

  @Field("string")
  declare memo: string | null;

  @Field("string")
  declare hostedInvoiceUrl: string | null;

  @Field("string")
  declare invoicePdfUrl: string | null;

  @Field("any")
  declare metadata: InvoiceMetadata;

  @Field("date")
  declare paidAt: Date | null;

  @Field("date")
  declare voidedAt: Date | null;

  @Index({ crossInstance: true })
  @Field("date")
  declare issuedAt: Date;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
