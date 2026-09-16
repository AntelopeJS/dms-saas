import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const trialIdentitiesTableName = "saas_trial_identities";

/** One non-expiring trial allocation per hashed email or payment identity. */
@RegisterTable(trialIdentitiesTableName, CORE_SCHEMA_NAME)
export class TrialIdentity extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare revision: string;

  @Field("string")
  declare tenantId: string | null;
}
