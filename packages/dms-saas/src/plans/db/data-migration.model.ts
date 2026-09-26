import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { DataMigration, dataMigrationsTableName } from "./data-migration.table";

export class DataMigrationModel extends BasicDataModel(
  DataMigration,
  dataMigrationsTableName,
) {
  async isApplied(name: string): Promise<boolean> {
    return !!(await this.get(name));
  }

  /** Idempotent: instances booting together may both finish the migration. */
  async markApplied(name: string): Promise<void> {
    if (await this.isApplied(name)) return;
    try {
      await this.insert({ _id: name });
    } catch (error) {
      if (!(await this.isApplied(name))) throw error;
    }
  }
}
