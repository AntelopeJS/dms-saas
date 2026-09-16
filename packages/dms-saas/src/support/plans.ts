import type { SupportMessage, SupportTicket, SupportTicketEvent } from "../db";
import type { SupportPublication } from "./operations";
import type {
  AddSupportMessageOptions,
  CreateSupportTicketOptions,
  SupportTicketUpdate,
  UpdateSupportTicketOptions,
} from "./service";
import {
  assertSupportStatusTransition,
  statusAfterPlatformReply,
  statusAfterTenantMessage,
} from "./transitions";

function ticketEvents(
  ticket: SupportTicket,
  next: SupportTicket,
  actorId: string,
  actorName: string,
): SupportTicketEvent[] {
  return [
    {
      type: "status_changed" as const,
      previousValue: ticket.status,
      newValue: next.status,
    },
    {
      type: "assignment_changed" as const,
      previousValue: ticket.assignedTo,
      newValue: next.assignedTo,
    },
  ]
    .filter((change) => change.previousValue !== change.newValue)
    .map((change) => ({
      ...change,
      _id: `${next.mutationId}:${change.type}`,
      ticketId: ticket._id,
      actorId,
      actorName,
      createdAt: next.updatedAt,
    }));
}

function nextTicket(
  ticket: SupportTicket,
  operationId: string,
  update: SupportTicketUpdate,
): SupportTicket {
  return {
    _id: ticket._id,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    createdBy: ticket.createdBy,
    createdAt: ticket.createdAt,
    status: update.status,
    assignedTo: update.assignedTo,
    lastMessageAt: update.lastMessageAt ?? ticket.lastMessageAt,
    updatedAt: update.updatedAt,
    revision: ticket.revision + 1,
    mutationId: operationId,
    publicationId: operationId,
  };
}

/** Captures creation's immutable business data before any attachment/storage side effect. */
export function createSupportPlan(
  options: CreateSupportTicketOptions,
  id: string,
): SupportPublication {
  const now = new Date();
  const ticket: SupportTicket = {
    _id: id,
    subject: options.input.subject,
    category: options.input.category,
    priority: options.input.priority,
    status: "open",
    assignedTo: null,
    createdBy: options.authorId,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    revision: 0,
    mutationId: id,
    publicationId: id,
  };
  const message: SupportMessage = {
    _id: `${id}:message`,
    ticketId: id,
    authorId: options.authorId,
    authorType: "tenant",
    body: options.input.body,
    attachments: [],
    createdAt: now,
  };
  return {
    expectedMutationId: null,
    ticket,
    message,
    events: [],
    stagedKeys: options.input.attachments,
  };
}

/** Captures the reply transition against one settled ticket revision. */
export function replySupportPlan(
  options: AddSupportMessageOptions,
  ticket: SupportTicket,
  id: string,
): SupportPublication {
  const now = new Date();
  const status =
    options.authorType === "tenant"
      ? statusAfterTenantMessage(ticket.status)
      : statusAfterPlatformReply(ticket.status);
  const next = nextTicket(ticket, id, {
    status,
    assignedTo: ticket.assignedTo,
    updatedAt: now,
    lastMessageAt: now,
  });
  const message: SupportMessage = {
    _id: `${id}:message`,
    ticketId: ticket._id,
    authorId: options.authorId,
    authorType: options.authorType,
    body: options.input.body,
    attachments: [],
    createdAt: now,
  };
  return {
    expectedMutationId: ticket.mutationId,
    ticket: next,
    message,
    events: ticketEvents(
      ticket,
      next,
      options.authorId,
      options.authorName || options.authorId,
    ),
    stagedKeys: options.input.attachments,
  };
}

/** Captures only validated operator intent; the receipt remains stable across later ticket changes. */
export function updateSupportPlan(
  options: UpdateSupportTicketOptions,
  ticket: SupportTicket,
  id: string,
): SupportPublication {
  const status = options.input.status ?? ticket.status;
  assertSupportStatusTransition(ticket.status, status);
  const assignedTo =
    options.input.assignedTo === undefined
      ? ticket.assignedTo
      : options.input.assignedTo;
  const next = nextTicket(ticket, id, {
    status,
    assignedTo,
    updatedAt: new Date(),
  });
  const events = ticketEvents(ticket, next, options.actorId, options.actorName);
  return {
    expectedMutationId: ticket.mutationId,
    unchanged: events.length === 0,
    ticket: events.length ? next : ticket,
    message: null,
    events,
    stagedKeys: [],
  };
}
