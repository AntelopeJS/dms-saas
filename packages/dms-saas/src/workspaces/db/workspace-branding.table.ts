import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import type { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const workspaceBrandingTableName = "saas_workspace_branding";

/** How a workspace shows itself in the switcher: one row per workspace. */
@RegisterTable(workspaceBrandingTableName, TENANT_SCHEMA_NAME)
export class WorkspaceBranding extends Table {
  /** The workspace's tenant id. */
  @Field("string")
  declare _id: string;

  /** The logo, as the DMS image type stores it; null shows the initial. */
  @Field("any")
  declare logo: DefaultDataTypes.ImageValue | null;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
