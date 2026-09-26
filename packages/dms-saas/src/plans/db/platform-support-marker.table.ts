import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const platformSupportMarkersTableName = "saas_platform_support_markers";

/**
 * Marks a membership as held by platform support rather than by the customer.
 * Every workspace shares one physical collection, so the id pairs the
 * workspace with the member, as tenant memberships do: a platform owner
 * supporting several workspaces holds one marker in each.
 */
@RegisterTable(platformSupportMarkersTableName, TENANT_SCHEMA_NAME)
export class PlatformSupportMarker extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare userId: string;

  @CreationTime()
  @Field("date")
  declare markedAt: Date;
}

export function platformSupportMarkerId(
  tenantId: string,
  userId: string,
): string {
  return `${tenantId}:${userId}`;
}
