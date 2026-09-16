import { randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  StripeWebhookEvent,
  stripeWebhookEventsTableName,
} from "../tables/stripeWebhookEvents.table";

const EPOCH_LOWER_BOUND = new Date(0);
const TERMINAL_RESULTS = new Set(["success", "skipped"]);

export type WebhookCompletion =
  | "success"
  | "skipped"
  | "reconciliation_required";

/** Durable webhook admission; uncertainty never authorizes another executor. */
export class StripeWebhookEventModel extends BasicDataModel(
  StripeWebhookEvent,
  stripeWebhookEventsTableName,
) {
  /** Return the admitted revision, or acknowledge an already completed event. */
  async tryClaim(eventId: string, type: string): Promise<string | undefined> {
    const revision = randomUUID();
    try {
      await this.insert({
        _id: eventId,
        type,
        processedAt: new Date(),
        result: "pending",
        errorMessage: null,
        revision,
      });
      return revision;
    } catch (error) {
      const existing = await this.get(eventId);
      if (!existing || existing.revision === revision) throw error;
      if (existing.type === type && TERMINAL_RESULTS.has(existing.result))
        return undefined;
      throw new Error(
        "Webhook requires reconciliation; an existing attempt may have applied effects",
      );
    }
  }

  /** Only this admitted invocation may record its result; unknown acknowledgements propagate. */
  async markResult(
    eventId: string,
    admittedRevision: string,
    result: WebhookCompletion,
    errorMessage: string | null,
  ): Promise<void> {
    const outcome = await this.table
      .atomicMutation(eventId, {
        type: "update",
        revisionField: "revision",
        expectedRevision: admittedRevision,
        nextRevision: randomUUID(),
        patch: { result, errorMessage, processedAt: new Date() },
      })
      .run();
    if (outcome !== "applied")
      throw new Error(`Webhook completion ${outcome}; reconciliation required`);
  }

  /** Retain unresolved attempts indefinitely; fence cleanup of terminal receipts. */
  async deleteProcessedBefore(cutoff: Date): Promise<void> {
    const candidates = await this.table
      .between("processedAt", EPOCH_LOWER_BOUND, cutoff)
      .run();
    for (const candidate of candidates) {
      const current = await this.get(candidate._id);
      if (
        !current ||
        !TERMINAL_RESULTS.has(current.result) ||
        current.processedAt >= cutoff
      )
        continue;
      const outcome = await this.table
        .atomicMutation(current._id, {
          type: "delete",
          revisionField: "revision",
          expectedRevision:
            current.revision === undefined
              ? { kind: "missing" }
              : current.revision,
        })
        .run();
      if (outcome === "unknown")
        throw new Error("Webhook cleanup outcome is unknown");
    }
  }
}
