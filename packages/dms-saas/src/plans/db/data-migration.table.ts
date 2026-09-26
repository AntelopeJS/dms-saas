import {
  CreationTime,
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const dataMigrationsTableName = "saas_data_migrations";

/** One-shot data migrations already applied, keyed by migration name. */
@RegisterTable(dataMigrationsTableName, CORE_SCHEMA_NAME)
export class DataMigration extends Table {
  @Field("string")
  declare _id: string;

  @CreationTime()
  @Field("date")
  declare appliedAt: Date;
}
