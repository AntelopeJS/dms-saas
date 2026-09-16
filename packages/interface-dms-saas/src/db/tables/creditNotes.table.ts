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
import { Invoice } from "./invoices.table";
// A bidirectional relation cannot be declared without both sides
// naming each other. `@Relation({ to: () => X })` defers the
// reference to call time, which is what makes the cycle safe.
// oxlint-disable-next-line import/no-cycle
import { Refund } from "./refunds.table";

export const creditNotesTableName = "credit_notes";

export const CREDIT_NOTE_TYPES = [
  "pre_payment",
  "post_payment",
  "credit_to_balance",
  "refund",
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

  @Index()
  @Field("date")
  declare issuedAt: Date;

  @Field("date")
  declare voidedAt: Date | null;

  @Field("any")
  declare metadata: Record<string, unknown>;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
