import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";

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
 * Platform owners who enter a customer workspace do it to support it: they
 * never take one of the customer's seats, neither as members nor as invitees.
 */
export async function isPlatformOwnerUser(userId: string): Promise<boolean> {
  const user = await GetModel(UserModel).get(userId);
  return user?.owner === true;
}

export async function isPlatformOwnerEmail(email: string): Promise<boolean> {
  const user = await GetModel(UserModel).getByEmail(email);
  return user?.owner === true;
}

export async function countSeatedUsers(userIds: string[]): Promise<number> {
  const owners = await loadPlatformOwners();
  return userIds.filter((userId) => !owners.byUserId.has(userId)).length;
}

function toPlatformSupportMember(owner: User): PlatformSupportMember {
  return { userId: owner._id, name: owner.name, email: owner.email };
}

function listPlatformSupport(
  members: TenantMember[],
  owners: PlatformOwnerDirectory,
): PlatformSupportMember[] {
  return members.flatMap((member) => {
    const owner = owners.byUserId.get(member.userId);
    return owner ? [toPlatformSupportMember(owner)] : [];
  });
}

/**
 * A pending invite holds a seat as much as a member does — that is what the
 * enforcement counts, so the members page has to show the same breakdown or
 * the quota reads as wrong to whoever hits the 402. Platform owners hold no
 * seat: they are listed apart as platform support.
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
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const inviteModel = GetModel(UserInviteModel, tenantId);
  const [members, invites, owners] = await Promise.all([
    memberModel.listAll(),
    inviteModel.getAll(),
    loadPlatformOwners(),
  ]);
  const nowMs = Date.now();
  const pendingInvitees = new Set(
    invites
      .filter((invite) => new Date(invite.expiresAt).getTime() > nowMs)
      .map((invite) => normalizeEmail(invite.email))
      .filter((email) => !owners.emails.has(email)),
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
