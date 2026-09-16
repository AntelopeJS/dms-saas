import { randomUUID } from "node:crypto";
import type { AtomicMutationOutcome } from "@antelopejs/interface-database";
import {
  BasicDataModel,
  type DeepPartial,
  triggerEvent,
  type ValidateOptions,
} from "@antelopejs/interface-database-decorators";
import {
  TenantSubscription,
  type SubscriptionCronNotification,
  type SubscriptionTransition,
  type TenantSubscriptionStatus,
  tenantSubscriptionsTableName,
} from "../tables/tenantSubscriptions.table";

const STATUS_CANCELLED: TenantSubscriptionStatus = "cancelled";
const STATUS_PAST_DUE: TenantSubscriptionStatus = "past_due";
const STATUS_ACTIVE: TenantSubscriptionStatus = "active";
const STATUS_SUSPENDED: TenantSubscriptionStatus = "suspended";

/** Data access for tenant subscription lifecycle state. */
export class TenantSubscriptionModel extends BasicDataModel(
  TenantSubscription,
  tenantSubscriptionsTableName,
) {
  /** Initialize revisions for new records; legacy null revisions require migration. */
  override insert(
    rows: DeepPartial<TenantSubscription> | DeepPartial<TenantSubscription>[],
    options?: ValidateOptions,
  ): Promise<string[]> {
    const initialize = (
      row: DeepPartial<TenantSubscription>,
    ): DeepPartial<TenantSubscription> => ({ ...row, revision: randomUUID() });
    return super.insert(
      Array.isArray(rows) ? rows.map(initialize) : initialize(rows),
      options,
    );
  }

  /** Persist one observed revision, preserving the model's update modifiers. */
  async mutateRevision(
    current: TenantSubscription,
    patch: DeepPartial<TenantSubscription>,
  ): Promise<AtomicMutationOutcome> {
    const instance = TenantSubscriptionModel.fromPlainData(patch);
    triggerEvent(instance, "update");
    return this.table
      .atomicMutation(current._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision:
          current.revision === undefined
            ? { kind: "missing" }
            : current.revision,
        nextRevision: randomUUID(),
        patch: TenantSubscriptionModel.toDatabase(instance),
      })
      .run();
  }

  /** Ordinary writers cannot cross a pending external transition or deletion boundary. */
  override async update(
    id: string,
    patch: DeepPartial<TenantSubscription>,
    options?: ValidateOptions,
  ): Promise<number>;
  override async update(
    patch: DeepPartial<TenantSubscription>,
    options?: ValidateOptions,
  ): Promise<number>;
  override async update(
    idOrPatch: string | DeepPartial<TenantSubscription>,
    patchOrOptions?: DeepPartial<TenantSubscription> | ValidateOptions,
    options?: ValidateOptions,
  ): Promise<number> {
    const id = typeof idOrPatch === "string" ? idOrPatch : idOrPatch._id;
    const patch =
      typeof idOrPatch === "string"
        ? (patchOrOptions as DeepPartial<TenantSubscription>)
        : idOrPatch;
    const validation =
      typeof idOrPatch === "string"
        ? options
        : (patchOrOptions as ValidateOptions | undefined);
    if (!id) throw new Error("Subscription identity is required");
    if (
      validation?.validate &&
      !TenantSubscriptionModel.validate(patch, { partial: true }).ok
    )
      throw new Error("Invalid subscription patch");
    const current = await this.get(id);
    if (!current) return 0;
    if (current.deletionStartedAt || current.domainTransition)
      throw new Error("Subscription transition requires reconciliation");
    const { _id, ...changes } = patch;
    const outcome = await this.mutateRevision(current, changes);
    if (outcome !== "applied")
      throw new Error(`Subscription update ${outcome}; reload before retry`);
    return 1;
  }

  /** Admit durable intent before payment-provider effects; a competing intent fails closed. */
  async beginTransition(
    current: TenantSubscription,
    intent: SubscriptionTransition,
  ): Promise<void> {
    if (current.deletionStartedAt)
      throw new Error("Subscription deletion has started");
    if (
      current.domainTransition &&
      (current.domainTransition.operationId !== intent.operationId ||
        current.domainTransition.kind !== intent.kind ||
        current.domainTransition.targetPlanId !== intent.targetPlanId ||
        new Date(current.domainTransition.requestedAt).getTime() !==
          intent.requestedAt.getTime())
    ) {
      throw new Error("Subscription has a different pending transition");
    }
    const outcome = await this.mutateRevision(current, {
      domainTransition: intent,
    });
    if (outcome !== "applied")
      throw new Error(
        `Subscription admission ${outcome}; reconciliation required`,
      );
  }

  /** Update only the persisted operation; uncertainty retains intent for reconciliation. */
  async updateDuringTransition(
    id: string,
    operationId: string,
    patch: DeepPartial<TenantSubscription>,
  ): Promise<void> {
    const current = await this.get(id);
    if (
      !current ||
      current.deletionStartedAt ||
      current.domainTransition?.operationId !== operationId
    )
      throw new Error("Subscription operation is no longer current");
    const outcome = await this.mutateRevision(current, patch);
    if (outcome !== "applied")
      throw new Error(
        `Subscription operation ${outcome}; reconciliation required`,
      );
  }

  /** Clear intent only after all external effects have durable recovery evidence. */
  async completeTransition(
    id: string,
    operationId: string,
    patch: DeepPartial<TenantSubscription>,
  ): Promise<void> {
    await this.updateDuringTransition(id, operationId, {
      ...patch,
      domainTransition: null,
    });
  }

  async findOne(): Promise<TenantSubscription | undefined> {
    const row = await this.table
      .orderBy("updatedAt", "desc")
      .nth(0)
      .default(undefined)
      .run();
    return row ? TenantSubscriptionModel.fromDatabase(row) : undefined;
  }

  async findOneByStripeCustomer(
    stripeCustomerId: string,
  ): Promise<TenantSubscription | undefined> {
    const row = await this.table
      .getAll(stripeCustomerId, "stripeCustomerId")
      .nth(0)
      .default(undefined)
      .run();
    return row ? TenantSubscriptionModel.fromDatabase(row) : undefined;
  }

  async findByCardFingerprint(
    cardFingerprint: string,
  ): Promise<TenantSubscription[]> {
    const rows = await this.table
      .getAll(cardFingerprint, "cardFingerprint")
      .filter((row) => row.key("status").ne(STATUS_CANCELLED))
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async findByPlan(planId: string): Promise<TenantSubscription[]> {
    const rows = await this.table.getAll(planId, "planId").run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async countByPlan(planId: string): Promise<number> {
    return this.table.getAll(planId, "planId").count().run();
  }

  async claimSelfRefund(subscriptionId: string): Promise<boolean> {
    const existing = await this.get(subscriptionId);
    if (!existing || existing.refundRequestedAt) return false;
    await this.update(subscriptionId, { refundRequestedAt: new Date() });
    return true;
  }

  async releaseSelfRefund(subscriptionId: string): Promise<void> {
    await this.update(subscriptionId, { refundRequestedAt: null });
  }

  async findByStatus(
    status: TenantSubscriptionStatus,
  ): Promise<TenantSubscription[]> {
    const rows = await this.table.getAll(status, "status").run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async findCancelledOrPastDue(): Promise<TenantSubscription[]> {
    const rows = await this.table
      .getAll([STATUS_CANCELLED, STATUS_PAST_DUE], "status")
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async findCancelledUpdatedBefore(
    cutoff: Date,
  ): Promise<TenantSubscription[]> {
    const rows = await this.table
      .filter((row) =>
        row
          .key("deletionStartedAt")
          .ne(null)
          .or(
            row
              .key("status")
              .eq(STATUS_CANCELLED)
              .and(row.key("updatedAt").lt(cutoff)),
          ),
      )
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async findPastDueSinceBefore(cutoff: Date): Promise<TenantSubscription[]> {
    const rows = await this.table
      .getAll(STATUS_PAST_DUE, "status")
      .filter((row) =>
        row
          .key("pastDueSince")
          .ne(null)
          .and(row.key("pastDueSince").lt(cutoff)),
      )
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  /** Commits the suspension and notification intent in one revision mutation. */
  async suspendPastDue(subscriptionId: string, cutoff: Date): Promise<void> {
    const current = await this.get(subscriptionId);
    if (
      !current ||
      current.deletionStartedAt ||
      current.domainTransition ||
      current.status !== STATUS_PAST_DUE ||
      !current.pastDueSince ||
      current.pastDueSince >= cutoff
    )
      return;
    const outcome = await this.mutateRevision(current, {
      status: STATUS_SUSPENDED,
      cronNotification: {
        kind: "suspended",
        eventId: JSON.stringify([
          "suspended",
          current._id,
          current.pastDueSince.toISOString(),
        ]),
      },
    });
    if (outcome === "unknown") throw new Error("Suspension outcome is unknown");
  }

  async findExpiredFreeBefore(cutoff: Date): Promise<TenantSubscription[]> {
    const rows = await this.table
      .getAll(STATUS_ACTIVE, "status")
      .filter((row) =>
        row
          .key("freeUntil")
          .ne(null)
          .and(row.key("freeUntil").lt(cutoff))
          .and(row.key("stripeSubscriptionId").eq(null)),
      )
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  async findFreeEndingBetween(
    start: Date,
    end: Date,
  ): Promise<TenantSubscription[]> {
    const rows = await this.table
      .getAll(STATUS_ACTIVE, "status")
      .filter((row) =>
        row
          .key("freeUntil")
          .ne(null)
          .and(row.key("freeUntil").ge(start))
          .and(row.key("freeUntil").lt(end))
          .and(row.key("stripeSubscriptionId").eq(null)),
      )
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter((row): row is TenantSubscription => row !== undefined);
  }

  /** Commits expiry and its retryable notification without a cross-record crash window. */
  async expireFree(subscriptionId: string, cutoff: Date): Promise<void> {
    const current = await this.get(subscriptionId);
    if (
      !current ||
      current.deletionStartedAt ||
      current.domainTransition ||
      current.status !== STATUS_ACTIVE ||
      !current.freeUntil ||
      current.freeUntil >= cutoff ||
      current.stripeSubscriptionId
    )
      return;
    const outcome = await this.mutateRevision(current, {
      status: STATUS_PAST_DUE,
      pastDueSince: new Date(),
      cronNotification: {
        kind: "free_expired",
        eventId: JSON.stringify([
          "free_expired",
          current._id,
          current.freeUntil.toISOString(),
        ]),
      },
    });
    if (outcome === "unknown")
      throw new Error("Free expiry outcome is unknown");
  }

  /** Finds durable work even after its status has left the candidate query. */
  async findCronNotifications(
    kind: SubscriptionCronNotification["kind"],
  ): Promise<TenantSubscription[]> {
    const rows = await this.table
      .filter((row) => row.key("cronNotification").ne(null))
      .run();
    return rows
      .map((row) => TenantSubscriptionModel.fromDatabase(row))
      .filter(
        (row): row is TenantSubscription =>
          row?.cronNotification?.kind === kind,
      );
  }

  /** Acknowledges only the exact intent observed by the delivery attempt. */
  async completeCronNotification(
    subscription: TenantSubscription,
  ): Promise<void> {
    const current = await this.get(subscription._id);
    if (
      !current ||
      current.cronNotification?.eventId !==
        subscription.cronNotification?.eventId
    )
      return;
    const outcome = await this.mutateRevision(current, {
      cronNotification: null,
    });
    if (outcome === "unknown")
      throw new Error("Notification acknowledgement is unknown");
  }

  /** Irreversible admission fences all ordinary writers before deletion effects. */
  async beginCancelledDeletion(
    subscriptionId: string,
    cutoff: Date,
  ): Promise<TenantSubscription | undefined> {
    const current = await this.get(subscriptionId);
    if (!current) return undefined;
    if (current.deletionStartedAt) return current;
    if (
      current.domainTransition ||
      current.status !== STATUS_CANCELLED ||
      current.updatedAt >= cutoff
    )
      return undefined;
    const outcome = await this.mutateRevision(current, {
      deletionStartedAt: new Date(),
      cronNotification: null,
    });
    if (outcome === "unknown")
      throw new Error("Deletion admission outcome is unknown");
    return outcome === "applied" ? this.get(subscriptionId) : undefined;
  }

  /** Deletes only the admitted subscription after every replayable cleanup succeeds. */
  async finishDeletion(subscription: TenantSubscription): Promise<void> {
    if (!subscription.deletionStartedAt)
      throw new Error("Subscription deletion was not admitted");
    const outcome = await this.table
      .atomicMutation(subscription._id, {
        type: "delete",
        revisionField: "revision",
        expectedRevision:
          subscription.revision === undefined
            ? { kind: "missing" }
            : subscription.revision,
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Subscription deletion outcome is unknown");
  }

  async deleteAll(): Promise<void> {
    await this.table.delete().run();
  }
}
