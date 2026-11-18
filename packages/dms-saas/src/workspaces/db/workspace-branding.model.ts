import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import type { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  WorkspaceBranding,
  workspaceBrandingTableName,
} from "./workspace-branding.table";

/** Reads and writes the branding of the workspace it is scoped to. */
export class WorkspaceBrandingModel extends BasicDataModel(
  WorkspaceBranding,
  workspaceBrandingTableName,
) {
  async getLogo(tenantId: string): Promise<DefaultDataTypes.ImageValue | null> {
    return (await this.get(tenantId))?.logo ?? null;
  }

  async setLogo(
    tenantId: string,
    logo: DefaultDataTypes.ImageValue | null,
  ): Promise<void> {
    await this.table
      .insert(
        { _id: tenantId, logo, updatedAt: new Date() },
        { conflict: "update" },
      )
      .run();
  }
}
