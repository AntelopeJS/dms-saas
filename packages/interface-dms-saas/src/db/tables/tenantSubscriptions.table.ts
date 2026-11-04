import { MakePropertyDecorator } from "@antelopejs/interface-core/decorators";
import {
  attachModifier,
  CreationTime,
  Field,
  Index,
  Modifier,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { Plan } from "./plans.table";
import type { PlanChangeIncompatibility } from "../../plan-changes";

export const tenantSubscriptionsTableName = "tenant_subscriptions";

export const TENANT_SUBSCRIPTION_STATUSES = [
  "pending_payment",
  "active",
  "trialing",
  "past_due",
  "suspended",
  "cancelled",
] as const;
export type TenantSubscriptionStatus =
  (typeof TENANT_SUBSCRIPTION_STATUSES)[number];

/**
 * Latest applicable status notice, committed with its transition. A newer
 * transition supersedes obsolete notices so delivery failure never blocks billing.
 */
export interface SubscriptionCronNotification {
  eventId: string;
  kind: "free_expired" | "suspended";
}

/** Persisted billing intent, retained until its external outcome is reconciled. */
export interface SubscriptionTransition {
  operationId: string;
  kind: "suspend" | "reactivate" | "change_plan" | "cancel" | "checkout";
  targetPlanId: string | null;
  requestedAt: Date;
}

/** Durable deadline and incident evidence for an application-validated Free change. */
export interface GuardedPlanChange {
  operationId: string;
  policyName: string;
  targetPlanId: string;
  stripeSubscriptionId: string;
  requestedAt: Date;
  effectiveAt: Date;
  /** Unique for each preparation/landing attempt, never reused after release. */
  barrierId: string;
  /** Only inventory-only work may be CAS-aborted after this timestamp. */
  validationStartedAt?: Date;
  /** Provider phases never expire or replay solely because a worker timed out. */
  phase:
    | "preparing"
    | "aborting"
    | "provider_pending"
    | "scheduled"
    | "cancel_pending"
    | "effective"
    | "activating"
    | "blocked";
  incompatibilities: PlanChangeIncompatibility[];
}

/** Half-open paid usage coverage. All time outside recorded periods is waived. */
export interface PaidUsagePeriod {
  stripeSubscriptionId: string;
  start: Date;
  end: Date | null;
}

const PAST_DUE_STATUS: TenantSubscriptionStatus = "past_due";

interface DunningClockPatch {
  status?: TenantSubscriptionStatus;
}

class DunningClockModifier extends Modifier {
  update(object: DunningClockPatch, field: string): void {
    if (object.status === undefined) return;
    const isWritten = Object.entries(object).some(
      ([key, value]) => key === field && value !== undefined,
    );
    if (isWritten) return;
    if (object.status !== PAST_DUE_STATUS) {
      Object.assign(object, { [field]: null });
    }
  }
}

/**
 * Structural half of the dunning clock: any status write through the model
 * that leaves `past_due` disarms the clock, so no status-transition path can
 * forget it. Arming stays explicit at the two entry points (payment-failure
 * webhook, free-expiry cron), which know whether an episode is already
 * running. Bulk table updates bypass modifiers and manage the field
 * themselves.
 */
export const DunningClock = MakePropertyDecorator((target, propertyKey) => {
  attachModifier(target.constructor, DunningClockModifier, propertyKey, {});
});

/** Subscription and payment-provider state for one tenant. */
@RegisterTable(tenantSubscriptionsTableName, TENANT_SCHEMA_NAME)
export class TenantSubscription extends Table {
  @Field("string")
  declare _id: string;

  @Index({ crossInstance: true })
  @Field("string")
  @Relation({ to: () => Plan })
  declare planId: string | null;

  @Index({ crossInstance: true })
  @Field("string")
  declare status: TenantSubscriptionStatus;

  /** Irreversible admission to replayable tenant deletion. */
  @Field("date")
  declare deletionStartedAt: Date | null;

  @Field("any")
  declare cronNotification: SubscriptionCronNotification | null;

  @Index({ crossInstance: true })
  @Field("string")
  declare stripeCustomerId: string | null;

  @Field("string")
  declare stripeSubscriptionId: string | null;

  @Field("string")
  declare stripeCheckoutSessionId: string | null;

  @Field("string")
  declare completedCheckoutSessionId: string | null;

  /**
   * Fingerprint of the card backing this workspace, mirrored from Stripe at
   * provisioning time. Free workspaces are capped per card and
   * `TrialConsumption` only records cards that actually consumed a trial, so
   * the cap needs its own record.
   */
  @Index({ crossInstance: true })
  @Field("string")
  declare cardFingerprint: string | null;

  /** Start of the Stripe subscription's current billing period. */
  @Field("date")
  declare currentPeriodStart: Date | null;

  @Field("date")
  declare currentPeriodEnd: Date | null;

  @Index({ crossInstance: true })
  @Field("string")
  @Relation({ to: () => Plan })
  declare pendingPlanId: string | null;

  @Field("date")
  declare pendingPlanChangeAt: Date | null;

  /** Kept on failure; neither invoice payment nor policy unload opens this gate. */
  @Field("any")
  declare guardedPlanChange: GuardedPlanChange | null;

  @Field("any")
  declare domainTransition: SubscriptionTransition | null;

  @Field("string")
  declare revision: string;

  @Field("string")
  @Relation({ to: () => User })
  declare createdBy: string | null;

  @Field("date")
  declare refundRequestedAt: Date | null;

  /**
   * When an owner deleted the workspace, cleared once it resumes: the
   * restricted screen tells a deletion apart from a cancelled subscription.
   */
  @Field("date")
  declare deletionRequestedAt: Date | null;

  /** The owner who deleted the workspace, with `deletionRequestedAt`. */
  @Field("string")
  declare deletionRequestedBy: string | null;

  /** Dunning clock: when the subscription entered `past_due`, driving the
   * auto-suspend deadline. Kept apart from `updatedAt`, which any write moves.
   * Disarmed by construction on any status write that leaves `past_due`. */
  @DunningClock()
  @Index()
  @Field("date")
  declare pastDueSince: Date | null;

  @Index()
  @Field("date")
  declare freeUntil: Date | null;

  /** Explicit admin gift marker, independent of an existing Stripe customer. */
  @Field("boolean")
  declare isComplimentary: boolean;

  /** Earliest usage eligible for the current paid subscription, excluding gifted/grace usage. */
  @Field("date")
  declare paidUsageStartedAt?: Date | null;

  /** Paid usage coverage; an empty array means no usage is billable. */
  @Field("any")
  declare paidUsagePeriods: PaidUsagePeriod[];

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Index()
  @Field("date")
  declare updatedAt: Date;
}
