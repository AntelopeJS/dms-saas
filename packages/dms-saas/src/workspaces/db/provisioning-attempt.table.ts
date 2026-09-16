import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export type ProvisioningAttemptState =
  | "preparing"
  | "awaiting_payment"
  | "committed"
  | "cancelled"
  | "reconciliation_required";
export const provisioningAttemptsTableName = "saas_provisioning_attempts";

/** Recovery evidence without persisting opaque provisioning hook input. */
@RegisterTable(provisioningAttemptsTableName, CORE_SCHEMA_NAME)
export class ProvisioningAttempt extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare revision: string;

  @Field("string")
  declare capacityId: string | null;

  @Field("string")
  declare planId: string;

  @Field("string")
  declare userId: string;

  @Index()
  @Field("string")
  declare state: ProvisioningAttemptState;

  @Field("string")
  declare stripeCustomerId: string | null;

  @Field("string")
  declare stripeSubscriptionId: string | null;

  @Field("string")
  declare trialConsumptionId: string | null;

  @Field("any")
  declare trialIdentityIds: string[];

  @Field("string")
  declare lastError: string | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
