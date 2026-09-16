import { createHash } from "node:crypto";
import { assert } from "@antelopejs/interface-api-util";
import {
  BasicDataModel,
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { SupportMessage, SupportTicket, SupportTicketEvent } from "../db";

const HTTP_CONFLICT = 409;
const HTTP_UNAVAILABLE = 503;
const SUPPORT_OPERATIONS_TABLE = "support_operations";

export type SupportOperationStatus =
  | "prepared"
  | "ready"
  | "committed"
  | "rejected";
export type SupportOperationKind = "create" | "reply" | "update";

export interface SupportOperationFailure {
  status: number;
  code: string;
}

export interface SupportPublication {
  expectedMutationId: string | null;
  unchanged?: boolean;
  ticket: SupportTicket;
  message: SupportMessage | null;
  events: SupportTicketEvent[];
  stagedKeys: string[];
}

/** Permanent request receipt; identities and prepared payloads are never reused. */
@RegisterTable(SUPPORT_OPERATIONS_TABLE, TENANT_SCHEMA_NAME)
export class SupportOperation extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare revision: string;

  @Field("string")
  declare status: SupportOperationStatus;

  @Field("string")
  declare fingerprint: string;

  @Field("string")
  declare kind: SupportOperationKind;

  @Field("string")
  declare payload: string;

  @Field("any")
  declare failure?: SupportOperationFailure | null;
}

/** Durable receipts use the same single-row atomic primitive as tickets. */
export class SupportOperationModel extends BasicDataModel(SupportOperation) {
  /** Inserts once, then reconciles an ambiguous acknowledgement by identity. */
  async prepare(candidate: SupportOperation): Promise<SupportOperation> {
    try {
      await this.insert(candidate);
    } catch {
      // Insert errors include duplicate requests and lost acknowledgements.
    }
    const stored = await this.get(candidate._id);
    assert(stored, HTTP_UNAVAILABLE, "saas.errors.support.operation_pending");
    assert(
      stored.fingerprint === candidate.fingerprint,
      HTTP_CONFLICT,
      "saas.errors.support.request_reused",
    );
    return stored;
  }

  /** Terminal receipts are persisted before another ticket publication is allowed. */
  async finish(
    operation: SupportOperation,
    status: SupportOperationStatus,
    failure: SupportOperationFailure | null = null,
  ): Promise<SupportOperation> {
    if (operation.status === status) return operation;
    const outcome = await this.table
      .atomicMutation(operation._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: operation.revision,
        nextRevision: `${operation._id}:${status}`,
        patch: { status, failure },
      })
      .run();
    const stored = await this.get(operation._id);
    assert(
      stored?.status === status,
      HTTP_UNAVAILABLE,
      outcome === "unknown"
        ? "saas.errors.support.operation_unknown"
        : "saas.errors.support.operation_pending",
    );
    return stored;
  }
}

/** Stable, actor-scoped request identity, independent of transport attempts. */
export function supportOperationId(
  tenantId: string,
  actorId: string,
  requestId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([tenantId, actorId, requestId]))
    .digest("hex");
}

/** Fingerprints normalized user intent, excluding server timestamps and snapshots. */
export function supportRequestFingerprint(intent: unknown): string {
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

/** Decodes the immutable publication, restoring dates across JSON-backed adapters. */
export function supportPublication(
  operation: SupportOperation,
): SupportPublication {
  const publication: SupportPublication = JSON.parse(operation.payload);
  const { ticket, message, events } = publication;
  ticket.createdAt = new Date(ticket.createdAt);
  ticket.updatedAt = new Date(ticket.updatedAt);
  ticket.lastMessageAt = new Date(ticket.lastMessageAt);
  if (message) message.createdAt = new Date(message.createdAt);
  for (const event of events) event.createdAt = new Date(event.createdAt);
  return publication;
}
