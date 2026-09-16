import { HTTPResult } from "@antelopejs/interface-api";
import { assert } from "@antelopejs/interface-api-util";
import {
  FileNotFoundError,
  FileConflictError,
  stripStagingPrefix,
} from "@antelopejs/interface-file-storage";
import type { Tenant } from "@antelopejs/interface-dms/db";
import type {
  SupportMessage,
  SupportMessageAuthorType,
  SupportMessageModel,
  SupportTicket,
  SupportTicketEventModel,
  SupportTicketModel,
  SupportTicketStatus,
} from "../db";
import {
  cancelSupportAttachments,
  prepareSupportAttachments,
} from "./admissions";
import {
  type SupportOperation,
  type SupportOperationKind,
  SupportOperationModel,
  supportOperationId,
  type SupportPublication,
  supportRequestFingerprint,
} from "./operations";
import {
  createSupportPlan,
  replySupportPlan,
  updateSupportPlan,
} from "./plans";
import {
  committedSupportPublication,
  publishSupportOperation,
  readSupportTicket,
} from "./publications";
import {
  assertSupportRequestId,
  type SupportMessageInput,
  type SupportTicketInput,
} from "./validation";

const HTTP_CONFLICT = 409;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;

export interface SupportModels {
  tickets: SupportTicketModel;
  messages: SupportMessageModel;
  events: SupportTicketEventModel;
}

export interface CreateSupportTicketOptions {
  tenant: Tenant;
  authorId: string;
  requestId: string;
  input: SupportTicketInput;
  models: SupportModels;
  validateNewRequest?: () => Promise<void>;
}

export interface AddSupportMessageOptions {
  tenantId: string;
  ticketId: string;
  authorId: string;
  authorName?: string;
  authorType: SupportMessageAuthorType;
  requestId: string;
  input: SupportMessageInput;
  models: SupportModels;
}

export interface SupportTicketUpdate {
  status: SupportTicketStatus;
  assignedTo: string | null;
  updatedAt: Date;
  lastMessageAt?: Date;
}

export interface SupportTicketPatch {
  status?: SupportTicketStatus;
  assignedTo?: string | null;
}

export interface UpdateSupportTicketOptions {
  tenantId: string;
  ticketId: string;
  requestId: string;
  input: SupportTicketPatch;
  actorId: string;
  actorName: string;
  models: SupportModels;
  validateNewRequest?: () => Promise<void>;
}

interface OperationRequest {
  tenantId: string;
  actorId: string;
  requestId: string;
  kind: SupportOperationKind;
  intent: unknown;
  models: SupportModels;
  plan: (id: string) => Promise<SupportPublication>;
}

async function prepareOperation(
  request: OperationRequest,
): Promise<SupportOperation> {
  assertSupportRequestId(request.requestId);
  const id = supportOperationId(
    request.tenantId,
    request.actorId,
    request.requestId,
  );
  const fingerprint = supportRequestFingerprint([request.kind, request.intent]);
  const operations = new SupportOperationModel(request.models.tickets.database);
  const existing = await operations.get(id);
  if (existing) {
    assert(
      existing.fingerprint === fingerprint,
      HTTP_CONFLICT,
      "saas.errors.support.request_reused",
    );
    return existing;
  }
  const publication = await request.plan(id);
  if (publication.message)
    publication.message.attachments =
      publication.stagedKeys.map(stripStagingPrefix);
  return operations.prepare({
    _id: id,
    revision: `${id}:prepared`,
    status: "prepared",
    kind: request.kind,
    fingerprint,
    payload: JSON.stringify(publication),
  });
}

function isTerminalPreparationError(error: unknown): boolean {
  if (error instanceof HTTPResult)
    return (
      error.getStatus() === HTTP_BAD_REQUEST ||
      error.getStatus() === HTTP_CONFLICT
    );
  return (
    error instanceof FileNotFoundError || error instanceof FileConflictError
  );
}

async function recoverPreparationFailure(
  operations: SupportOperationModel,
  operation: SupportOperation,
  error: unknown,
): Promise<SupportOperation> {
  if (isTerminalPreparationError(error)) {
    const failure =
      error instanceof HTTPResult && typeof error.getBody() === "string"
        ? { status: error.getStatus(), code: String(error.getBody()) }
        : {
            status: HTTP_CONFLICT,
            code: "saas.errors.support.invalid_attachments",
          };
    await operations
      .finish(operation, "rejected", failure)
      .catch(() => undefined);
  }
  const current = await operations.get(operation._id);
  if (current?.status === "rejected") await cancelSupportAttachments(current);
  if (!current || current.status === "prepared") throw error;
  return current;
}

async function readyOperation(
  tenantId: string,
  models: SupportModels,
  operation: SupportOperation,
): Promise<SupportOperation> {
  const operations = new SupportOperationModel(models.tickets.database);
  if (operation.status !== "prepared") return operation;
  try {
    await prepareSupportAttachments(operations, operation, tenantId);
    await operations.finish(operation, "ready");
  } catch (error) {
    return recoverPreparationFailure(operations, operation, error);
  }
  const current = await operations.get(operation._id);
  assert(current, HTTP_UNAVAILABLE, "saas.errors.support.operation_pending");
  return current;
}

async function runSupportOperation(
  request: OperationRequest,
): Promise<SupportPublication> {
  const prepared = await prepareOperation(request);
  const result = await resumeSupportOperation(
    request.tenantId,
    request.models,
    prepared,
  );
  return committedSupportPublication(result);
}

/** Replays persisted intent, including incomplete rejection cleanup, without inventing a request. */
export async function resumeSupportOperation(
  tenantId: string,
  models: SupportModels,
  operation: SupportOperation,
): Promise<SupportOperation> {
  const ready = await readyOperation(tenantId, models, operation);
  const result = await publishSupportOperation(models, ready);
  if (result.status === "rejected") await cancelSupportAttachments(result);
  return result;
}

function ticketResult(publication: SupportPublication): SupportTicket {
  if (publication.unchanged) return publication.ticket;
  publication.ticket.publicationId = null;
  publication.ticket.mutationId = `${publication.ticket.mutationId}:settled`;
  return publication.ticket;
}

/** Creates once per tenant/actor/request ID; transport retries return the durable original result. */
export async function createSupportTicket(
  options: CreateSupportTicketOptions,
): Promise<SupportTicket> {
  const publication = await runSupportOperation({
    tenantId: options.tenant._id,
    actorId: options.authorId,
    requestId: options.requestId,
    kind: "create",
    intent: options.input,
    models: options.models,
    plan: async (id) => {
      await options.validateNewRequest?.();
      return createSupportPlan(options, id);
    },
  });
  return ticketResult(publication);
}

/** Publishes one reply and its transition with durable replay and forward reconciliation. */
export async function addSupportMessage(
  options: AddSupportMessageOptions,
): Promise<SupportMessage> {
  const publication = await runSupportOperation({
    tenantId: options.tenantId,
    actorId: options.authorId,
    requestId: options.requestId,
    kind: "reply",
    intent: [options.ticketId, options.authorType, options.input],
    models: options.models,
    plan: async (id) =>
      replySupportPlan(
        options,
        await readSupportTicket(options.models, options.ticketId),
        id,
      ),
  });
  assert(
    publication.message,
    HTTP_UNAVAILABLE,
    "saas.errors.support.operation_pending",
  );
  return publication.message;
}

/** Records operator intent once, returning its receipt rather than reapplying on retry. */
export async function updateSupportTicket(
  options: UpdateSupportTicketOptions,
): Promise<SupportTicket> {
  const publication = await runSupportOperation({
    tenantId: options.tenantId,
    actorId: options.actorId,
    requestId: options.requestId,
    kind: "update",
    intent: [options.ticketId, options.input],
    models: options.models,
    plan: async (id) => {
      await options.validateNewRequest?.();
      return updateSupportPlan(
        options,
        await readSupportTicket(options.models, options.ticketId),
        id,
      );
    },
  });
  return ticketResult(publication);
}
