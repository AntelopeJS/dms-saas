import {
  CreationTime,
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const platformSupportMarkersTableName = "saas_platform_support_markers";

/**
 * Marks a membership as held by platform support rather than by the customer.
 * Keyed by the member's user id: a workspace holds one membership per user.
 */
@RegisterTable(platformSupportMarkersTableName, TENANT_SCHEMA_NAME)
export class PlatformSupportMarker extends Table {
  @Field("string")
  declare _id: string;

  @CreationTime()
  @Field("date")
  declare markedAt: Date;
}
