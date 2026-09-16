import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  TrialConsumption,
  trialConsumptionsTableName,
} from "../tables/trialConsumptions.table";

/** Data access for consumed trial identities. */
export class TrialConsumptionModel extends BasicDataModel(
  TrialConsumption,
  trialConsumptionsTableName,
) {
  async findByUser(userId: string): Promise<TrialConsumption[]> {
    const rows = await this.table.getAll(userId, "userId").run();
    return rows
      .map((row) => TrialConsumptionModel.fromDatabase(row))
      .filter((row): row is TrialConsumption => row !== undefined);
  }

  async existsForIdentity(
    emailHash: string,
    paymentFingerprint: string | null,
  ): Promise<boolean> {
    const emailCount = await this.table
      .getAll(emailHash, "emailHash")
      .count()
      .run();
    if (emailCount > 0) return true;
    if (!paymentFingerprint) return false;
    const fingerprintCount = await this.table
      .getAll(paymentFingerprint, "paymentFingerprint")
      .count()
      .run();
    return fingerprintCount > 0;
  }
}
