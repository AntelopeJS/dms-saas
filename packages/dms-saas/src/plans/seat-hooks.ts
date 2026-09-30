import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { CustomButtonUnavailability } from "@antelopejs/interface-dms/base/types";
import type { ComponentFilterContext } from "@antelopejs/interface-dms/component";
import {
  Hook,
  type InviteDeletedReason,
  RegisterHook,
} from "@antelopejs/interface-dms/hooks";
import { RegisterInviteAvailability } from "@antelopejs/interface-dms/invite-extensions";
import type { Plan } from "../db";
import { PlanModel, TenantSubscriptionModel } from "../db";
import {
  isPlatformSupportEntry,
  isPlatformSupportInvite,
} from "./platform-support";
import {
  countOccupiedSeats,
  countSeatedUsers,
  hasSeatCapacity,
} from "./seat-capacity";
import { syncStripeSeatQuantity } from "./seat-sync";

const HTTP_PAYMENT_REQUIRED = 402;

const SEAT_LIMIT_INVITE_UNAVAILABLE: CustomButtonUnavailability = {
  reason: "$saas.plans.seat_limit.invite_unavailable",
};

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

/**
 * Disables the invite action once every seat of the plan is taken, so the
 * admin learns it before filling the form rather than from the refusal of
 * `INVITE_BEING_CREATED`. Reissuing an existing invitation and inviting a
 * platform owner for support still pass that hook, but are rare enough not to
 * keep the button enabled for them.
 */
async function resolveInviteSeatAvailability({
  tenantId,
}: ComponentFilterContext): Promise<CustomButtonUnavailability | undefined> {
  const active = await getActivePlanForTenant(tenantId);
  if (!active) return undefined;
  const occupied = await countOccupiedSeats(tenantId);
  return hasSeatCapacity(active.plan.maxMembers, occupied)
    ? undefined
    : SEAT_LIMIT_INVITE_UNAVAILABLE;
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
  removedUserIds: string[],
  idempotencyKey: string,
): Promise<void> {
  const active = await getActivePlanForTenant(tenantId);
  if (!active) return;
  const [currentOccupied, removedSeats] = await Promise.all([
    countOccupiedSeats(tenantId),
    countSeatedUsers(tenantId, removedUserIds),
  ]);
  const nextOccupied = Math.max(0, currentOccupied - removedSeats);
  await syncStripeSeatQuantity({
    tenantId,
    plan: active.plan,
    stripeSubscriptionId: active.stripeSubscriptionId,
    idempotencyKey,
    quantityOverride: nextOccupied,
  });
}

// Platform owners entering a workspace they do not own come to support it,
// never as one of its seats: they pass the quota and leave the billed
// quantity untouched. A workspace owner is the customer and always holds one.
export function registerSeatHooks(): void {
  RegisterInviteAvailability(resolveInviteSeatAvailability);
  RegisterHook(
    Hook.MEMBER_BEING_ADDED,
    async ({ tenantId, userId, isTenantOwner, deliveryId }) => {
      // A delivery id means an accepted invitation: the membership takes over
      // the seat that invitation already held, and it is still counted here.
      if (deliveryId) return undefined;
      if (await isPlatformSupportEntry(userId, isTenantOwner)) return undefined;
      await enforceSeatCapacity(tenantId);
      return undefined;
    },
  );
  // An invitation to an already-invited email replaces the existing one (a
  // resend, a renewed link), so that invitee's seat is not claimed twice.
  RegisterHook(
    Hook.INVITE_BEING_CREATED,
    async ({ tenantId, email, asTenantOwner }) => {
      if (await isPlatformSupportInvite(email, asTenantOwner)) return undefined;
      await enforceSeatCapacity(tenantId, email);
      return undefined;
    },
  );
  RegisterHook(
    Hook.MEMBER_ADDED,
    async ({ tenantId, userId, isTenantOwner, deliveryId }) => {
      // The accepted invitation is still stored at this point; its deletion
      // right after syncs the count once it no longer holds the seat.
      if (deliveryId) return undefined;
      if (await isPlatformSupportEntry(userId, isTenantOwner)) return undefined;
      await syncSeatsAfterChange(
        tenantId,
        `seat-sync:member-added:${tenantId}:${userId}`,
      );
      return undefined;
    },
  );
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
  // The hook runs before the memberships are deleted, while they still tell
  // which of them held a seat.
  RegisterHook(Hook.MEMBER_REMOVED, async ({ tenantId, userIds }) => {
    await syncSeatsAfterRemoval(
      tenantId,
      userIds,
      `seat-sync:member-removed:${tenantId}:${userIds.join(",")}`,
    );
    return undefined;
  });
}
