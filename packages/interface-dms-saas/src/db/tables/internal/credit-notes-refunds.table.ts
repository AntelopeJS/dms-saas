/**
 * The credit note and refund tables, declared together because each names the
 * other in a relation.
 *
 * @internal @packageDocumentation
 */
import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { Invoice } from "../invoices.table";

export const refundsTableName = "refunds";

export const REFUND_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Refund issued through the configured payment provider. */
@RegisterTable(refundsTableName, TENANT_SCHEMA_NAME)
export class Refund extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => CreditNote })
  declare creditNoteId: string;

  @Index()
  @Field("string")
  declare stripeRefundId: string;

  @Field("number")
  declare amount: number;

  @Field("string")
  declare currency: string;

  @Field("string")
  declare status: RefundStatus;

  @Field("string")
  declare failureReason: string | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}

export const creditNotesTableName = "credit_notes";

export const CREDIT_NOTE_TYPES = [
  "pre_payment",
  "post_payment",
  "credit_to_balance",
  "refund",
  "mixed",
] as const;
export type CreditNoteType = (typeof CREDIT_NOTE_TYPES)[number];

export const CREDIT_NOTE_STATUSES = ["issued", "void"] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

/** Credit issued against a tenant invoice. */
@RegisterTable(creditNotesTableName, TENANT_SCHEMA_NAME)
export class CreditNote extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Invoice })
  declare invoiceId: string;

  @Index()
  @Field("string")
  declare stripeCreditNoteId: string;

  @Field("string")
  declare number: string;

  @Field("number")
  declare amount: number;

  @Field("string")
  declare currency: string;

  @Field("string")
  declare reason: string;

  @Field("string")
  declare memo: string | null;

  @Field("string")
  declare type: CreditNoteType;

  @Field("string")
  @Relation({ to: () => Refund })
  declare refundId: string | null;

  @Field("string")
  declare hostedUrl: string | null;

  @Field("string")
  declare pdfUrl: string | null;

  @Field("string")
  declare status: CreditNoteStatus;

  @Index({ crossInstance: true })
  @Field("date")
  declare issuedAt: Date;

  @Field("date")
  declare voidedAt: Date | null;

  @Field("any")
  declare metadata: Record<string, string>;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
