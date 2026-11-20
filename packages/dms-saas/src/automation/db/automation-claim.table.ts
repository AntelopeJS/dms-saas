import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const automationClaimsTableName = "saas_automation_claims";

/**
 * One trigger event already handed to automation. Platform-level: the row id
 * holds the workspace id with the event's delivery id, so two workspaces
 * never share a claim.
 */
@RegisterTable(automationClaimsTableName, CORE_SCHEMA_NAME)
export class AutomationClaim extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare tenantId: string;

  @Field("string")
  declare deliveryId: string;

  @Index()
  @Field("date")
  declare createdAt: Date;
}
