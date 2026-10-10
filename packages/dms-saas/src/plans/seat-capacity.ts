import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  type UserInvite,
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
  emails: Set<string>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function loadPlatformOwners(): Promise<PlatformOwnerDirectory> {
  const owners = await GetModel(UserModel).getOwners();
  return {
    byUserId: new Map(owners.map((owner) => [owner._id, owner])),
    emails: new Set(owners.map((owner) => normalizeEmail(owner.email))),
  };
}

/**
 * A membership is platform support when its user is a platform owner and it
 * does not own the workspace — an owner is the customer and always takes a
 * seat.
 */
function supportUserOf(
  member: TenantMember,
  owners: PlatformOwnerDirectory,
): User | undefined {
  if (member.isTenantOwner) return undefined;
  return owners.byUserId.get(member.userId);
}

/**
 * Platform owners invited to a workspace hold no seat, unless the invitation
 * hands them its ownership: that invitee is the customer.
 */
function holdsSeat(
  invite: UserInvite,
  owners: PlatformOwnerDirectory,
): boolean {
  return (
    invite.asTenantOwner || !owners.emails.has(normalizeEmail(invite.email))
  );
}

/** How many of these members, all still in the workspace, hold a seat. */
export async function countSeatedUsers(
  tenantId: string,
  userIds: string[],
): Promise<number> {
  const [members, owners] = await Promise.all([
    GetModel(TenantMemberModel, tenantId).listAll(),
    loadPlatformOwners(),
  ]);
  const supportUserIds = new Set(
    members
      .filter((member) => supportUserOf(member, owners))
      .map((member) => member.userId),
  );
  return userIds.filter((userId) => !supportUserIds.has(userId)).length;
}

function toPlatformSupportMember(owner: User): PlatformSupportMember {
  return { userId: owner._id, name: owner.name, email: owner.email };
}

function listPlatformSupport(
  members: TenantMember[],
  owners: PlatformOwnerDirectory,
): PlatformSupportMember[] {
  return members.flatMap((member) => {
    const owner = supportUserOf(member, owners);
    return owner ? [toPlatformSupportMember(owner)] : [];
  });
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
 * about to be replaced, since the replacement takes that seat over.
 */
export async function getSeatUsage(
  tenantId: string,
  releasedInviteeEmail?: string,
): Promise<SeatUsage> {
  const [members, invites, owners] = await Promise.all([
    GetModel(TenantMemberModel, tenantId).listAll(),
    GetModel(UserInviteModel, tenantId).getAll(),
    loadPlatformOwners(),
  ]);
  const nowMs = Date.now();
  const pendingInvitees = new Set(
    invites
      .filter((invite) => new Date(invite.expiresAt).getTime() > nowMs)
      .filter((invite) => holdsSeat(invite, owners))
      .map((invite) => normalizeEmail(invite.email)),
  );
  if (releasedInviteeEmail) {
    pendingInvitees.delete(normalizeEmail(releasedInviteeEmail));
  }
  const platformSupport = listPlatformSupport(members, owners);
  const seatedMembers = members.length - platformSupport.length;
  return {
    members: seatedMembers,
    pendingInvites: pendingInvitees.size,
    occupied: seatedMembers + pendingInvitees.size,
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
