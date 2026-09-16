import { isDeepStrictEqual } from "node:util";
import { assert } from "@antelopejs/interface-api-util";
import {
  type SupportTicket,
  type SupportTicketModel,
  SupportMessageModel,
  SupportTicketEventModel,
} from "../db";
import {
  type SupportOperation,
  SupportOperationModel,
  supportPublication,
} from "./operations";
import type { SupportModels } from "./service";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNAVAILABLE = 503;
const MAX_PUBLICATIONS_PER_READ = 8;

/** Reconciles a scoped read without requiring callers to resolve projection models. */
export async function reconcileSupportTicket(
  tickets: SupportTicketModel,
  ticketId: string,
): Promise<SupportTicket> {
  const ticket = await tickets.get(ticketId);
  assert(ticket, HTTP_NOT_FOUND, "saas.errors.support.ticket_not_found");
  if (!ticket.publicationId) return ticket;
  return readSupportTicket(
    {
      tickets,
      messages: new SupportMessageModel(tickets.database),
      events: new SupportTicketEventModel(tickets.database),
    },
    ticketId,
  );
}

interface ProjectionRow {
  _id: string;
}

interface ProjectionModel<T extends ProjectionRow> {
  insert(rows: T[]): Promise<unknown>;
  get(id: string): PromiseLike<T | undefined>;
}

async function insertProjection<T extends ProjectionRow>(
  model: ProjectionModel<T>,
  row: T,
): Promise<void> {
  try {
    await model.insert([row]);
  } catch {
    // A retry can meet an already materialized projection or a lost insert ack.
  }
  const stored = await model.get(row._id);
  assert(
    stored &&
      Object.entries(row).every(([key, value]) =>
        isDeepStrictEqual(stored[key as keyof T], value),
      ),
    HTTP_UNAVAILABLE,
    "saas.errors.support.projection_pending",
  );
}

/** Repairs the committed ticket publication; all workers project the same immutable data. */
export async function reconcileSupportPublication(
  models: SupportModels,
  ticket: SupportTicket,
): Promise<void> {
  if (!ticket.publicationId) return;
  const operations = new SupportOperationModel(models.tickets.database);
  const operation = await operations.get(ticket.publicationId);
  assert(
    operation && operation.status !== "rejected",
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  const publication = supportPublication(operation);
  assert(
    publication.ticket._id === ticket._id,
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  if (publication.message)
    await insertProjection(models.messages, publication.message);
  for (const event of publication.events)
    await insertProjection(models.events, event);
  await operations.finish(operation, "committed");
  await models.tickets.settlePublication(ticket._id, operation._id);
}

/** Reads a thread only after its committed messages and history are materialized. */
export async function readSupportTicket(
  models: SupportModels,
  ticketId: string,
): Promise<SupportTicket> {
  for (let attempt = 0; attempt < MAX_PUBLICATIONS_PER_READ; attempt += 1) {
    const ticket = await models.tickets.get(ticketId);
    assert(ticket, HTTP_NOT_FOUND, "saas.errors.support.ticket_not_found");
    if (!ticket.publicationId) return ticket;
    await reconcileSupportPublication(models, ticket);
  }
  throw new Error("Support publication did not settle within the read budget");
}

async function publishTicket(
  models: SupportModels,
  operation: SupportOperation,
): Promise<void> {
  const publication = supportPublication(operation);
  if (publication.expectedMutationId !== null) {
    await models.tickets.publish(
      publication.ticket,
      publication.expectedMutationId,
    );
    return;
  }
  try {
    await models.tickets.insert([publication.ticket]);
  } catch {
    // Creation is insert-once at a request-derived ticket ID; reconcile below.
  }
}

/** Resolves ambiguous publication from its durable receipt or ticket evidence, never a new ID. */
export async function publishSupportOperation(
  models: SupportModels,
  operation: SupportOperation,
): Promise<SupportOperation> {
  const operations = new SupportOperationModel(models.tickets.database);
  const current = await operations.get(operation._id);
  assert(current, HTTP_UNAVAILABLE, "saas.errors.support.operation_pending");
  if (current.status !== "ready") return current;
  operation = current;
  if (supportPublication(operation).unchanged) {
    return operations.finish(operation, "committed");
  }
  await publishTicket(models, operation);
  const publication = supportPublication(operation);
  const ticket = await models.tickets.get(publication.ticket._id);
  if (ticket?.publicationId === operation._id) {
    await reconcileSupportPublication(models, ticket);
  }
  const stored = await operations.get(operation._id);
  assert(stored, HTTP_UNAVAILABLE, "saas.errors.support.operation_pending");
  if (stored.status !== "ready") return stored;
  if (
    ticket &&
    ticket.mutationId !== publication.expectedMutationId &&
    ticket.mutationId !== operation._id
  ) {
    return operations.finish(stored, "rejected");
  }
  assert(false, HTTP_UNAVAILABLE, "saas.errors.support.operation_unknown");
}

/** Returns the original result; a known revision conflict is terminal for this request ID. */
export function committedSupportPublication(operation: SupportOperation) {
  assert(
    operation.status !== "rejected",
    operation.failure?.status ?? HTTP_CONFLICT,
    operation.failure?.code ?? "saas.errors.support.tenant_busy",
  );
  assert(
    operation.status === "committed",
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  return supportPublication(operation);
}
