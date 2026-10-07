import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { Tenant } from "@antelopejs/interface-dms/db/tables/tenants.table";
import type { PlanBillingMode, PlanInterval } from "./plans.table";

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

/** Where the workspace owner stands: joined, invited, or nobody. */
export const WORKSPACE_OWNER_STATUSES = [
  "joined",
  "invited",
  "expired",
  "none",
] as const;
export type WorkspaceOwnerStatus = (typeof WORKSPACE_OWNER_STATUSES)[number];

/**
 * The next date that matters for a workspace, and what happens on it: a
 * renewal, the end of a trial or of complimentary access, an automatic
 * suspension, the deletion of a cancelled workspace's data. `suspended` and
 * `awaiting_payment` date the state instead: since when it holds.
 */
export const WORKSPACE_RENEWAL_KINDS = [
  "renews",
  "trial_ends",
  "free_until",
  "suspends",
  "suspended",
  "awaiting_payment",
  "deletes",
] as const;
export type WorkspaceRenewalKind = (typeof WORKSPACE_RENEWAL_KINDS)[number];

/**
 * What the workspace directory lists, sorts and filters on, denormalised from
 * the subscription, its plan, the members and the owner's invitation every
 * time the billing state is recomputed. Amounts are in minor units of
 * `currency`.
 */
export interface WorkspaceDirectoryFields {
  planId: string | null;
  planName: string | null;
  planInterval: PlanInterval | null;
  planBillingMode: PlanBillingMode | null;
  planUnitAmountMinor: number | null;
  currency: string | null;
  /** Seats Stripe bills: members and pending invitations, support excluded. */
  seats: number;
  isComplimentary: boolean;
  /** Normalised monthly recurring revenue; 0 when nothing is billed. */
  mrrMinor: number;
  /** `mrrMinor` before the last change of billing state (what a churn lost). */
  previousMrrMinor: number;
  renewalKind: WorkspaceRenewalKind | null;
  renewsAt: Date | null;
  /** When the current billing state was first observed. */
  stateSince: Date | null;
  ownerStatus: WorkspaceOwnerStatus;
  ownerNeverJoined: boolean;
  ownerName: string | null;
  ownerEmail: string | null;
}

/**
 * Platform-level billing access state for one tenant, and the workspace
 * directory row the back office lists.
 */
@RegisterTable(tenantBillingStateTableName, CORE_SCHEMA_NAME)
export class TenantBillingState
  extends Table
  implements Partial<WorkspaceDirectoryFields>
{
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

  @Field("string")
  declare planId?: string | null;

  @Field("string")
  declare planName?: string | null;

  @Field("string")
  declare planInterval?: PlanInterval | null;

  @Field("string")
  declare planBillingMode?: PlanBillingMode | null;

  @Field("number")
  declare planUnitAmountMinor?: number | null;

  @Field("string")
  declare currency?: string | null;

  @Field("number")
  declare seats?: number;

  @Field("boolean")
  declare isComplimentary?: boolean;

  @Index()
  @Field("number")
  declare mrrMinor?: number;

  @Field("number")
  declare previousMrrMinor?: number;

  @Field("string")
  declare renewalKind?: WorkspaceRenewalKind | null;

  @Index()
  @Field("date")
  declare renewsAt?: Date | null;

  @Field("date")
  declare stateSince?: Date | null;

  @Field("string")
  declare ownerStatus?: WorkspaceOwnerStatus;

  @Field("boolean")
  declare ownerNeverJoined?: boolean;

  @Field("string")
  declare ownerName?: string | null;

  @Field("string")
  declare ownerEmail?: string | null;
}
