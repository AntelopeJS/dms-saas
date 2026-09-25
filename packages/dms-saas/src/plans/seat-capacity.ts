import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  TenantMemberModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";

export interface SeatUsage {
  members: number;
  pendingInvites: number;
  occupied: number;
}

/**
 * A pending invite holds a seat as much as a member does — that is what the
 * enforcement counts, so the members page has to show the same breakdown or
 * the quota reads as wrong to whoever hits the 402.
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
  const [members, invites] = await Promise.all([
    memberModel.listAll(),
    inviteModel.getAll(),
  ]);
  const nowMs = Date.now();
  const pendingInvitees = new Set(
    invites
      .filter((invite) => new Date(invite.expiresAt).getTime() > nowMs)
      .map((invite) => invite.email),
  );
  if (releasedInviteeEmail) pendingInvitees.delete(releasedInviteeEmail);
  return {
    members: members.length,
    pendingInvites: pendingInvitees.size,
    occupied: members.length + pendingInvitees.size,
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
