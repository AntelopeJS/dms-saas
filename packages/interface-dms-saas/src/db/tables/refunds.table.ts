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
// A bidirectional relation cannot be declared without both sides
// naming each other. `@Relation({ to: () => X })` defers the
// reference to call time, which is what makes the cycle safe.
// oxlint-disable-next-line import/no-cycle
import { CreditNote } from "./creditNotes.table";

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
