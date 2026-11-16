import { ValueProxy } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import type { Plan } from "../db";

/** A platform owner holding a membership to support the workspace. */
export interface PlatformSupportMember {
  userId: string;
  name: string;
  email: string;
}

export interface SeatUsage {
  members: number;
  pendingInvites: number;
  occupied: number;
  platformSupport: PlatformSupportMember[];
}

/**
 * Platform owners, keyed both ways a seat can be held: by user for a
 * membership, by email for an invitation.
 */
interface PlatformOwnerDirectory {
  byUserId: Map<string, User>;
  emails: string[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function loadPlatformOwners(): Promise<PlatformOwnerDirectory> {
  const owners = await GetModel(UserModel).getOwners();
  return {
    byUserId: new Map(owners.map((owner) => [owner._id, owner])),
    emails: owners.map((owner) => normalizeEmail(owner.email)),
  };
}

function isAmong(
  value: ValueProxy<string>,
  values: readonly string[],
): ValueProxy<boolean> {
  return ValueProxy.constant([...values]).includes(value);
}

function isStaying(
  member: ValueProxy<TenantMember>,
  departingUserIds: readonly string[],
): ValueProxy<boolean> {
  return isAmong(member.key("userId"), departingUserIds).not();
}

/**
 * The user ids of the platform support memberships these members hold. A
 * membership is platform support when its user is a platform owner and it
 * does not own the workspace — an owner is the customer and always takes a
 * seat.
 */
async function listSupportUserIds(
  tenantId: string,
  owners: PlatformOwnerDirectory,
  among: (member: ValueProxy<TenantMember>) => ValueProxy<boolean>,
): Promise<string[]> {
  const rows = await GetModel(TenantMemberModel, tenantId)
    .table.filter((member) =>
      isAmong(member.key("userId"), [...owners.byUserId.keys()])
        .and(member.key("isTenantOwner").ne(true))
        .and(among(member)),
    )
    .pluck("userId")
    .run();
  return rows.map((row) => row.userId);
}

/** How many of these members, all still in the workspace, hold a seat. */
export async function countSeatedUsers(
  tenantId: string,
  userIds: string[],
): Promise<number> {
  const owners = await loadPlatformOwners();
  const supportUserIds = new Set(
    await listSupportUserIds(tenantId, owners, (member) =>
      isAmong(member.key("userId"), userIds),
    ),
  );
  return userIds.filter((userId) => !supportUserIds.has(userId)).length;
}

function toPlatformSupportMember(owner: User): PlatformSupportMember {
  return { userId: owner._id, name: owner.name, email: owner.email };
}

/**
 * Invitees holding a seat through a live invitation. Platform owners invited
 * to a workspace hold no seat, unless the invitation hands them its
 * ownership: that invitee is the customer. Invitations store their email
 * normalized, so the stored email is the invitee.
 */
function countPendingInvitees(
  tenantId: string,
  owners: PlatformOwnerDirectory,
  releasedInviteeEmail: string | undefined,
): Promise<number> {
  const now = new Date();
  const released = releasedInviteeEmail
    ? [normalizeEmail(releasedInviteeEmail)]
    : [];
  return GetModel(UserInviteModel, tenantId)
    .table.filter((invite) =>
      invite
        .key("expiresAt")
        .gt(now)
        .and(
          invite
            .key("asTenantOwner")
            .eq(true)
            .or(isAmong(invite.key("email"), owners.emails).not()),
        )
        .and(isAmong(invite.key("email"), released).not()),
    )
    .count("email")
    .run();
}

/**
 * A pending invite holds a seat as much as a member does — that is what the
 * enforcement counts, so the members page has to show the same breakdown or
 * the quota reads as wrong to whoever hits the 402. Platform support holds no
 * seat: it is listed apart.
 *
 * The DMS keeps one invitation per email and reissues one by inserting its
 * successor before deleting it, so invitations are counted per invitee: the
 * two incarnations of a resent invitation hold a single seat.
 * `releasedInviteeEmail` leaves out the seat of an invitee whose invitation is
 * about to be replaced or deleted, `departingUserIds` the members about to be
 * removed: the DMS runs its removal hooks before it deletes.
 */
export async function getSeatUsage(
  tenantId: string,
  releasedInviteeEmail?: string,
  departingUserIds: readonly string[] = [],
): Promise<SeatUsage> {
  const owners = await loadPlatformOwners();
  const [members, supportUserIds, pendingInvites] = await Promise.all([
    GetModel(TenantMemberModel, tenantId)
      .table.filter((member) => isStaying(member, departingUserIds))
      .count()
      .run(),
    listSupportUserIds(tenantId, owners, (member) =>
      isStaying(member, departingUserIds),
    ),
    countPendingInvitees(tenantId, owners, releasedInviteeEmail),
  ]);
  const platformSupport = supportUserIds.flatMap((userId) => {
    const owner = owners.byUserId.get(userId);
    return owner ? [toPlatformSupportMember(owner)] : [];
  });
  const seatedMembers = members - platformSupport.length;
  return {
    members: seatedMembers,
    pendingInvites,
    occupied: seatedMembers + pendingInvites,
    platformSupport,
  };
}

export async function countOccupiedSeats(
  tenantId: string,
  releasedInviteeEmail?: string,
): Promise<number> {
  const usage = await getSeatUsage(tenantId, releasedInviteeEmail);
  return usage.occupied;
}

const SEAT_BILLING_MODE = "seat";
const FLAT_SEATS = 1;

/**
 * The seats a price comparison between plans counts: those the workspace
 * uses when one of the plans bills per seat, and none to read otherwise.
 *
 * @param plans The plans compared; a missing one is skipped
 */
export async function countSeatsToCompare(
  tenantId: string,
  plans: ReadonlyArray<Pick<Plan, "billingMode"> | null | undefined>,
): Promise<number> {
  const isPerSeat = plans.some(
    (plan) => plan?.billingMode === SEAT_BILLING_MODE,
  );
  return isPerSeat ? countOccupiedSeats(tenantId) : FLAT_SEATS;
}

export function hasSeatCapacity(
  maxMembers: number,
  currentSeats: number,
): boolean {
  if (maxMembers < 0) return true;
  return currentSeats < maxMembers;
}

export function fitsWithinSeatLimit(
  maxMembers: number,
  currentSeats: number,
): boolean {
  if (maxMembers < 0) return true;
  return currentSeats <= maxMembers;
}
