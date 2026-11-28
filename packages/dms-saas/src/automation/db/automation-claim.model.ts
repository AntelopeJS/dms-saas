import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  AutomationClaim,
  automationClaimsTableName,
} from "./automation-claim.table";

const EPOCH = new Date(0);

/** The id of a workspace's claim on a delivery. */
export function automationClaimId(
  tenantId: string,
  deliveryId: string,
): string {
  return JSON.stringify([tenantId, deliveryId]);
}

/** Claims on trigger events, so an event several runs see fires once. */
export class AutomationClaimModel extends BasicDataModel(
  AutomationClaim,
  automationClaimsTableName,
) {
  /**
   * Claims the delivery for the workspace.
   *
   * @returns False when it was already claimed
   */
  async claim(tenantId: string, deliveryId: string): Promise<boolean> {
    const id = automationClaimId(tenantId, deliveryId);
    try {
      await this.insert({
        _id: id,
        tenantId,
        deliveryId,
        createdAt: new Date(),
      });
      return true;
    } catch (error) {
      if (await this.get(id)) return false;
      throw error;
    }
  }

  /** Removes the claims made before `cutoff`. */
  async deleteClaimedBefore(cutoff: Date): Promise<void> {
    await this.table.between("createdAt", EPOCH, cutoff).delete().run();
  }
}
