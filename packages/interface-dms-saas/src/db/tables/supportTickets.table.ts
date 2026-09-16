import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";

export const supportTicketsTableName = "support_tickets";
export const SUPPORT_TICKET_ORDER_INDEX = "ticket_recent_order";
export const SUPPORT_TICKET_STATUS_ORDER_INDEX = "ticket_status_recent_order";

export const SUPPORT_TICKET_CATEGORIES = [
  "question",
  "incident",
  "billing",
  "feature_request",
] as const;
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export const SUPPORT_TICKET_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

export const SUPPORT_TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/** Tenant-owned support ticket. */
@RegisterTable(supportTicketsTableName, TENANT_SCHEMA_NAME)
export class SupportTicket extends Table {
  @Field("string")
  declare subject: string;

  @Index()
  @Field("string")
  declare category: SupportTicketCategory;

  @Index()
  @Field("string")
  declare priority: SupportTicketPriority;

  @Index()
  @Index({ group: SUPPORT_TICKET_STATUS_ORDER_INDEX })
  @Field("string")
  declare status: SupportTicketStatus;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare createdBy: string;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare assignedTo: string | null;

  @Field("number")
  declare revision: number;

  @Field("string")
  declare mutationId: string;

  @Field("string")
  declare publicationId?: string | null;

  @Index()
  @Index({ group: SUPPORT_TICKET_ORDER_INDEX })
  @Index({ group: SUPPORT_TICKET_STATUS_ORDER_INDEX })
  @Field("date")
  declare lastMessageAt: Date;

  @Index({ group: SUPPORT_TICKET_ORDER_INDEX })
  @Index({ group: SUPPORT_TICKET_STATUS_ORDER_INDEX })
  @Field("string")
  declare _id: string;

  // Timestamps belong to the durable publication, not its materialization attempt.
  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare updatedAt: Date;
}
