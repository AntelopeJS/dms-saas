import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  SupportTicket,
  supportTicketsTableName,
} from "../tables/supportTickets.table";

/**
 * Data access for support tickets in one tenant schema.
 * Publication requires the explicit atomicMutation capability; unsupported adapters fail closed.
 */
export class SupportTicketModel extends BasicDataModel(
  SupportTicket,
  supportTicketsTableName,
) {
  /** Commits business state and its pending projection in one ticket mutation. */
  publish(
    ticket: SupportTicket,
    expectedMutationId: string,
  ): Promise<AtomicMutationOutcome> {
    const { _id, mutationId, ...patch } = ticket;
    return this.table
      .atomicMutation(_id, {
        type: "update",
        revisionField: "mutationId",
        expectedRevision: expectedMutationId,
        nextRevision: mutationId,
        patch,
      })
      .run();
  }

  /** A committed receipt must exist before its ticket can admit another publication. */
  settlePublication(
    id: string,
    operationId: string,
  ): Promise<AtomicMutationOutcome> {
    return this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "mutationId",
        expectedRevision: operationId,
        nextRevision: `${operationId}:settled`,
        patch: { publicationId: null },
      })
      .run();
  }
}
