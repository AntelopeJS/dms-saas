import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { Plan } from "./plans.table";

export const trialConsumptionsTableName = "trial_consumptions";

/** Identity and payment fingerprint that consumed a plan trial. */
@RegisterTable(trialConsumptionsTableName, CORE_SCHEMA_NAME)
export class TrialConsumption extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare userId: string;

  @Index()
  @Field("string")
  declare emailHash: string;

  @Index()
  @Field("string")
  declare paymentFingerprint: string | null;

  @Index()
  @Field("string")
  @Relation({ to: () => Plan })
  declare planId: string;

  @CreationTime()
  @Field("date")
  declare consumedAt: Date;
}
