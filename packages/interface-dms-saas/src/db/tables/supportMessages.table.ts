import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { SupportTicket } from "./supportTickets.table";

export const supportMessagesTableName = "support_messages";
export const SUPPORT_MESSAGE_ORDER_INDEX = "ticket_message_order";

export const SUPPORT_MESSAGE_AUTHOR_TYPES = ["tenant", "platform"] as const;
export type SupportMessageAuthorType =
  (typeof SUPPORT_MESSAGE_AUTHOR_TYPES)[number];

/** Message in a tenant-owned support ticket thread. */
@RegisterTable(supportMessagesTableName, TENANT_SCHEMA_NAME)
export class SupportMessage extends Table {
  @Index()
  @Index({ group: SUPPORT_MESSAGE_ORDER_INDEX })
  @Field("string")
  @Relation({ to: () => SupportTicket })
  declare ticketId: string;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare authorId: string;

  @Field("string")
  declare authorType: SupportMessageAuthorType;

  @Field("string")
  declare body: string;

  @Field(["string"])
  declare attachments: string[];

  // Replay must retain the durable publication timestamp.
  @Index()
  @Index({ group: SUPPORT_MESSAGE_ORDER_INDEX })
  @Field("date")
  declare createdAt: Date;

  @Index({ group: SUPPORT_MESSAGE_ORDER_INDEX })
  @Field("string")
  declare _id: string;
}
