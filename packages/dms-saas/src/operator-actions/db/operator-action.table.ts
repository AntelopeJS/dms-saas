import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { Tenant } from "@antelopejs/interface-dms/db/tables/tenants.table";
import type {
  OperatorActionDetails,
  OperatorActionStatus,
  WorkspaceOperatorAction,
} from "../types";

export const operatorActionsTableName = "saas_operator_actions";

@RegisterTable(operatorActionsTableName, CORE_SCHEMA_NAME)
export class OperatorAction extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Tenant })
  declare tenantId: string;

  @Index()
  @Field("string")
  declare actorId: string;

  @Field("string")
  declare actorEmail: string;

  @Index()
  @Field("string")
  declare action: WorkspaceOperatorAction;

  @Index()
  @Field("string")
  declare status: OperatorActionStatus;

  @Field("string")
  declare requestFingerprint: string;

  @Field("any")
  declare details: OperatorActionDetails;

  @Field("number")
  declare attemptCount: number;

  @Field("string")
  declare revision?: string;

  @Field("string")
  declare lastErrorCode: string | null;

  @Field("date")
  declare effectiveAt: Date | null;

  @CreationTime()
  @Index()
  @Field("date")
  declare createdAt: Date;

  @Field("date")
  declare startedAt: Date | null;

  @Field("date")
  declare completedAt: Date | null;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
