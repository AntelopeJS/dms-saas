import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  Hook,
  type InviteDeletedReason,
  RegisterHook,
} from "@antelopejs/interface-dms/hooks";
import type { Plan } from "../db";
import { PlanModel, TenantSubscriptionModel } from "../db";
import { countOccupiedSeats, hasSeatCapacity } from "./seat-capacity";
import { syncStripeSeatQuantity } from "./seat-sync";

const HTTP_PAYMENT_REQUIRED = 402;

/** Deletions whose invitation lives on in a successor holding the same seat. */
const REISSUED_INVITE_REASONS: ReadonlySet<InviteDeletedReason> = new Set([
  "resent",
  "replaced",
]);

interface ActivePlanContext {
  plan: Plan;
  stripeSubscriptionId: string | null;
}

async function getActivePlanForTenant(
  tenantId: string,
): Promise<ActivePlanContext | null> {
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const planModel = GetModel(PlanModel);
  const subscription = await tenantSubscriptionModel.findOne();
  if (!subscription?.planId) return null;
  const plan = await planModel.get(subscription.planId);
  if (!plan) return null;
  return { plan, stripeSubscriptionId: subscription.stripeSubscriptionId };
}

async function enforceSeatCapacity(
  tenantId: string,
  releasedInviteeEmail?: string,
): Promise<void> {
  const active = await getActivePlanForTenant(tenantId);
  if (!active) return;
  const occupied = await countOccupiedSeats(tenantId, releasedInviteeEmail);
  assert(
    hasSeatCapacity(active.plan.maxMembers, occupied),
    HTTP_PAYMENT_REQUIRED,
    "saas.errors.plan.seat_limit_reached",
  );
}

async function syncSeatsAfterChange(
  tenantId: string,
  idempotencyKey: string,
  releasedInviteeEmail?: string,
): Promise<void> {
  const active = await getActivePlanForTenant(tenantId);
  if (!active) return;
  await syncStripeSeatQuantity({
    tenantId,
    plan: active.plan,
    stripeSubscriptionId: active.stripeSubscriptionId,
    idempotencyKey,
    quantityOverride: releasedInviteeEmail
      ? await countOccupiedSeats(tenantId, releasedInviteeEmail)
      : undefined,
  });
}

async function syncSeatsAfterRemoval(
  tenantId: string,
  removedCount: number,
  idempotencyKey: string,
): Promise<void> {
  const active = await getActivePlanForTenant(tenantId);
  if (!active) return;
  const currentOccupied = await countOccupiedSeats(tenantId);
  const nextOccupied = Math.max(0, currentOccupied - removedCount);
  await syncStripeSeatQuantity({
    tenantId,
    plan: active.plan,
    stripeSubscriptionId: active.stripeSubscriptionId,
    idempotencyKey,
    quantityOverride: nextOccupied,
  });
}

export function registerSeatHooks(): void {
  RegisterHook(Hook.MEMBER_BEING_ADDED, async ({ tenantId, deliveryId }) => {
    // A delivery id means an accepted invitation: the membership takes over
    // the seat that invitation already held, and it is still counted here.
    if (deliveryId) return undefined;
    await enforceSeatCapacity(tenantId);
    return undefined;
  });
  // An invitation to an already-invited email replaces the existing one (a
  // resend, a renewed link), so that invitee's seat is not claimed twice.
  RegisterHook(Hook.INVITE_BEING_CREATED, async ({ tenantId, email }) => {
    await enforceSeatCapacity(tenantId, email);
    return undefined;
  });
  RegisterHook(Hook.MEMBER_ADDED, async ({ tenantId, userId, deliveryId }) => {
    // The accepted invitation is still stored at this point; its deletion
    // right after syncs the count once it no longer holds the seat.
    if (deliveryId) return undefined;
    await syncSeatsAfterChange(
      tenantId,
      `seat-sync:member-added:${tenantId}:${userId}`,
    );
    return undefined;
  });
  RegisterHook(Hook.INVITE_CREATED, async ({ tenantId, inviteId }) => {
    await syncSeatsAfterChange(
      tenantId,
      `seat-sync:invite-created:${tenantId}:${inviteId}`,
    );
    return undefined;
  });
  // The hook runs before the row is deleted: an invitation that ends here
  // must not be billed, while a reissued one keeps its seat for its successor.
  RegisterHook(
    Hook.INVITE_DELETED,
    async ({ tenantId, inviteId, email, reason }) => {
      await syncSeatsAfterChange(
        tenantId,
        `seat-sync:invite-deleted:${tenantId}:${inviteId}`,
        REISSUED_INVITE_REASONS.has(reason) ? undefined : email,
      );
      return undefined;
    },
  );
  RegisterHook(Hook.MEMBER_REMOVED, async ({ tenantId, userIds }) => {
    await syncSeatsAfterRemoval(
      tenantId,
      userIds.length,
      `seat-sync:member-removed:${tenantId}:${userIds.join(",")}`,
    );
    return undefined;
  });
}
