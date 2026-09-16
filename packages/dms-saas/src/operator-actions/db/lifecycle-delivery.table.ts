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
import type { WorkspaceLifecycleTransition } from "@antelopejs/interface-dms-saas/workspace-lifecycle";
import type { OperatorActionStatus } from "../types";

export const lifecycleDeliveriesTableName = "saas_lifecycle_deliveries";

export type WorkspaceProvisioningState =
  | "preparing"
  | "awaiting_payment"
  | "committed"
  | "cancelled";

@RegisterTable(lifecycleDeliveriesTableName, CORE_SCHEMA_NAME)
export class LifecycleDelivery extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare operationId: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Tenant })
  declare tenantId: string;

  @Index()
  @Field("string")
  declare consumer: string;

  @Field("string")
  declare transition: WorkspaceLifecycleTransition;

  @Field("string")
  declare provisioningInvoiceId: string | null;

  @Field("string")
  declare provisioningState: WorkspaceProvisioningState | null;

  @Index()
  @Field("string")
  declare status: OperatorActionStatus;

  @Field("number")
  declare attemptCount: number;

  @Field("string")
  declare revision?: string;

  @Field("string")
  declare receiptId: string | null;

  @Field("date")
  declare acceptedAt: Date | null;

  @Field("date")
  declare effectiveAt: Date | null;

  @Field("string")
  declare lastErrorCode: string | null;

  @Field("date")
  declare requestedAt: Date;

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
