import { createHash, randomUUID } from "node:crypto";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  TrialIdentity,
  trialIdentitiesTableName,
} from "./trial-identity.table";

/** Hash namespace-separated anti-abuse identities without storing raw card fingerprints. */
export function trialIdentityId(
  kind: "email" | "card",
  identity: string,
): string {
  return createHash("sha256").update(`${kind}:${identity}`).digest("hex");
}

/** Trial admission has no lease; an uncertain grant retains both identity allocations. */
export class TrialIdentityModel extends BasicDataModel(
  TrialIdentity,
  trialIdentitiesTableName,
) {
  /** Reserve before asking Stripe to grant a trial. */
  async reserve(id: string, tenantId: string): Promise<boolean> {
    let current = await this.get(id);
    if (!current) {
      try {
        await this.insert({ _id: id, revision: randomUUID(), tenantId });
      } catch (error) {
        current = await this.get(id);
        if (!current) throw error;
      }
      current ??= await this.get(id);
    }
    if (!current) throw new Error("Trial reservation is missing");
    if (current.tenantId === tenantId) return true;
    if (current.tenantId !== null) return false;
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: { tenantId },
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Trial reservation outcome requires reconciliation");
    return outcome === "applied";
  }

  /** Release only before a provider request or after a proven cancellation and executor quiescence. */
  async releaseUnused(id: string, tenantId: string): Promise<void> {
    const current = await this.get(id);
    if (!current || current.tenantId !== tenantId) return;
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: { tenantId: null },
      })
      .run();
    if (outcome !== "applied")
      throw new Error(`Trial release ${outcome}; reconciliation required`);
  }
}
