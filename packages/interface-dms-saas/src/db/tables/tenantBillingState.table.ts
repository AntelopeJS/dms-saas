import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { Tenant } from "@antelopejs/interface-dms/db/tables/tenants.table";

export const tenantBillingStateTableName = "tenant_billing_state";

export const BILLING_STATES = [
  "free",
  "active",
  "trialing",
  "past_due",
  "suspended",
  "cancelled",
  "pending_payment",
] as const;
export type BillingState = (typeof BILLING_STATES)[number];

/** Platform-level billing access state for one tenant. */
@RegisterTable(tenantBillingStateTableName, CORE_SCHEMA_NAME)
export class TenantBillingState extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Tenant })
  declare tenantId: string;

  @Index()
  @Field("string")
  declare billingState: BillingState;

  @Field("date")
  declare updatedAt: Date;

  @Field("string")
  declare revision: string;

  /** Retained to prevent an in-flight recomputation recreating a deleted tenant. */
  @Field("date")
  declare deletedAt: Date | null;
}
