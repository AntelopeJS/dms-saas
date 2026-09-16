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

/** Half-open paid usage coverage. All time outside recorded periods is waived. */
export interface PaidUsagePeriod {
  stripeSubscriptionId: string;
  start: Date;
  end: Date | null;
}

const PAST_DUE_STATUS: TenantSubscriptionStatus = "past_due";

interface DunningClockPatch {
  status?: TenantSubscriptionStatus;
  [field: string]: unknown;
}

class DunningClockModifier extends Modifier {
  update(object: DunningClockPatch, field: string): void {
    if (object.status === undefined) return;
    if (object[field] !== undefined) return;
    if (object.status !== PAST_DUE_STATUS) {
      object[field] = null;
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
type AttachFieldModifier = (
  tableClass: new () => object,
  modifier: new () => Modifier,
  field: string,
  // Mirrors the shape the database decorators declare, where the value
  // is genuinely opaque to this side.
  // oxlint-disable-next-line anti-slop/no-object-parameters
  options: object,
) => void;

export const DunningClock = MakePropertyDecorator((target, propertyKey) => {
  (attachModifier as AttachFieldModifier)(
    target.constructor as new () => object,
    DunningClockModifier,
    propertyKey as string,
    {},
  );
});

/** Subscription and payment-provider state for one tenant. */
@RegisterTable(tenantSubscriptionsTableName, TENANT_SCHEMA_NAME)
export class TenantSubscription extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Plan })
  declare planId: string | null;

  @Index()
  @Field("string")
  declare status: TenantSubscriptionStatus;

  /** Irreversible admission to replayable tenant deletion. */
  @Field("date")
  declare deletionStartedAt: Date | null;

  @Field("any")
  declare cronNotification: SubscriptionCronNotification | null;

  @Index()
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
  @Index()
  @Field("string")
  declare cardFingerprint: string | null;

  @Field("date")
  declare currentPeriodEnd: Date | null;

  @Field("string")
  @Relation({ to: () => Plan })
  declare pendingPlanId: string | null;

  @Field("date")
  declare pendingPlanChangeAt: Date | null;

  @Field("any")
  declare domainTransition: SubscriptionTransition | null;

  @Field("string")
  declare revision?: string;

  @Field("string")
  @Relation({ to: () => User })
  declare createdBy: string | null;

  @Field("date")
  declare refundRequestedAt: Date | null;

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
  declare isComplimentary?: boolean;

  /** Earliest usage eligible for the current paid subscription, excluding gifted/grace usage. */
  @Field("date")
  declare paidUsageStartedAt?: Date | null;

  /** Missing means legacy billing; an empty array means no paid usage coverage. */
  @Field("any")
  declare paidUsagePeriods?: PaidUsagePeriod[] | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Index()
  @Field("date")
  declare updatedAt: Date;
}
