import { Controller } from "@antelopejs/interface-api";
import { DataController } from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Filter,
  Listable,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Searchable } from "@antelopejs/interface-dms/base";
import type {
  SupportMessageAuthorType,
  SupportTicketCategory,
  SupportTicketEventType,
  SupportTicketPriority,
  SupportTicketStatus,
} from "../db";
import {
  SUPPORT_EVENT_ORDER_INDEX,
  SUPPORT_MESSAGE_ORDER_INDEX,
  SUPPORT_TICKET_ORDER_INDEX,
  SupportMessage,
  SupportTicketEvent,
} from "../db";
import { HiddenStringFilter } from "./platformOwner/hidden-filter";

/** Shared public ticket projection; mutation fencing fields stay private. */
export class SupportTicketFields extends Controller("") {
  @Listable()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;
  @Listable()
  @Searchable()
  @Sortable({ noIndex: true })
  @Access(AccessMode.ReadOnly)
  declare subject: string;
  @Listable()
  @HiddenStringFilter()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare status: SupportTicketStatus;
  @Listable()
  @HiddenStringFilter()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare priority: SupportTicketPriority;
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare category: SupportTicketCategory;
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare assignedTo: string | null;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare createdBy: string;
  @Listable()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare lastMessageAt: Date;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare updatedAt: Date;
}

/** Shared ticket-scoped projection for conversation and audit collections. */
export class SupportThreadFields extends Controller("") {
  @Listable()
  @Sortable()
  @Access(AccessMode.ReadOnly)
  declare _id: string;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare ticketId: string;
  @Listable()
  @Sortable({ noIndex: true })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}

/** Public conversation fields. */
export class SupportMessageFields extends DataController(
  SupportMessage,
  {},
  Controller("", SupportThreadFields),
) {
  @Filter()
  declare ticketId: string;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare authorId: string;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare authorType: SupportMessageAuthorType;
  @Listable()
  @Searchable()
  @Access(AccessMode.ReadOnly)
  declare body: string;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare attachments: string[];
}

/** Public immutable audit fields. */
export class SupportEventFields extends DataController(
  SupportTicketEvent,
  {},
  Controller("", SupportThreadFields),
) {
  @Filter()
  declare ticketId: string;

  @Listable()
  @Access(AccessMode.ReadOnly)
  declare actorId: string;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare actorName: string;
  @Listable()
  @HiddenStringFilter()
  @Access(AccessMode.ReadOnly)
  declare type: SupportTicketEventType;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare previousValue: string | null;
  @Listable()
  @Access(AccessMode.ReadOnly)
  declare newValue: string | null;
}

Sortable()(SupportTicketFields.prototype, SUPPORT_TICKET_ORDER_INDEX);
Sortable()(SupportMessageFields.prototype, SUPPORT_MESSAGE_ORDER_INDEX);
Sortable()(SupportEventFields.prototype, SUPPORT_EVENT_ORDER_INDEX);
