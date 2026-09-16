import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  TenantBillingInfo,
  tenantBillingInfoTableName,
} from "../tables/tenantBillingInfo.table";

/** Data access for tenant billing identities. */
export class TenantBillingInfoModel extends BasicDataModel(
  TenantBillingInfo,
  tenantBillingInfoTableName,
) {
  async findOne(): Promise<TenantBillingInfo | undefined> {
    const row = await this.table
      .orderBy("updatedAt", "desc")
      .nth(0)
      .default(undefined)
      .run();
    return row ? TenantBillingInfoModel.fromDatabase(row) : undefined;
  }

  async deleteAll(): Promise<void> {
    await this.table.delete().run();
  }
}
