import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { SupportTicket } from "./supportTickets.table";

export const supportTicketEventsTableName = "support_ticket_events";
export const SUPPORT_EVENT_ORDER_INDEX = "ticket_event_order";
export type SupportTicketEventType = "status_changed" | "assignment_changed";

/** Immutable history of a ticket's status and assignment changes. */
@RegisterTable(supportTicketEventsTableName, TENANT_SCHEMA_NAME)
export class SupportTicketEvent extends Table {
  @Index()
  @Index({ group: SUPPORT_EVENT_ORDER_INDEX })
  @Relation({ to: () => SupportTicket })
  @Field("string")
  declare ticketId: string;

  // Replay must retain the durable publication timestamp.
  @Index({ group: SUPPORT_EVENT_ORDER_INDEX })
  @Field("date")
  declare createdAt: Date;

  @Index({ group: SUPPORT_EVENT_ORDER_INDEX })
  @Field("string")
  declare _id: string;

  @Field("string")
  declare actorId: string;

  @Field("string")
  declare actorName: string;

  @Field("string")
  declare type: SupportTicketEventType;

  @Field("string")
  declare previousValue: string | null;

  @Field("string")
  declare newValue: string | null;
}
