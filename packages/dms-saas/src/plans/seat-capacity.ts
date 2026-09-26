import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  type UserInvite,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { PlatformSupportMarkerModel } from "./db";

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

/** What tells a customer's seat from platform support in one workspace. */
interface SupportDirectory {
  owners: PlatformOwnerDirectory;
  markedUserIds: Set<string>;
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

async function loadSupportDirectory(
  tenantId: string,
): Promise<SupportDirectory> {
  const [owners, markedUserIds] = await Promise.all([
    loadPlatformOwners(),
    GetModel(PlatformSupportMarkerModel, tenantId).listUserIds(),
  ]);
  return { owners, markedUserIds };
}

/**
 * A membership is support only while all three hold: it was entered as
 * support, its user is still a platform owner, and it does not own the
 * workspace — an owner is the customer and always takes a seat.
 */
function supportUserOf(
  member: TenantMember,
  support: SupportDirectory,
): User | undefined {
  if (member.isTenantOwner) return undefined;
  if (!support.markedUserIds.has(member.userId)) return undefined;
  return support.owners.byUserId.get(member.userId);
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
  const [members, support] = await Promise.all([
    GetModel(TenantMemberModel, tenantId).listAll(),
    loadSupportDirectory(tenantId),
  ]);
  const supportUserIds = new Set(
    members
      .filter((member) => supportUserOf(member, support))
      .map((member) => member.userId),
  );
  return userIds.filter((userId) => !supportUserIds.has(userId)).length;
}

function toPlatformSupportMember(owner: User): PlatformSupportMember {
  return { userId: owner._id, name: owner.name, email: owner.email };
}

function listPlatformSupport(
  members: TenantMember[],
  support: SupportDirectory,
): PlatformSupportMember[] {
  return members.flatMap((member) => {
    const owner = supportUserOf(member, support);
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
  const [members, invites, support] = await Promise.all([
    GetModel(TenantMemberModel, tenantId).listAll(),
    GetModel(UserInviteModel, tenantId).getAll(),
    loadSupportDirectory(tenantId),
  ]);
  const nowMs = Date.now();
  const pendingInvitees = new Set(
    invites
      .filter((invite) => new Date(invite.expiresAt).getTime() > nowMs)
      .filter((invite) => holdsSeat(invite, support.owners))
      .map((invite) => normalizeEmail(invite.email)),
  );
  if (releasedInviteeEmail) {
    pendingInvitees.delete(normalizeEmail(releasedInviteeEmail));
  }
  const platformSupport = listPlatformSupport(members, support);
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
