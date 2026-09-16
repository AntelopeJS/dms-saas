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
 */
export async function getSeatUsage(tenantId: string): Promise<SeatUsage> {
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const inviteModel = GetModel(UserInviteModel, tenantId);
  const [members, invites] = await Promise.all([
    memberModel.listAll(),
    inviteModel.getAll(),
  ]);
  const nowMs = Date.now();
  const pendingInvites = invites.filter(
    (invite) => new Date(invite.expiresAt).getTime() > nowMs,
  );
  return {
    members: members.length,
    pendingInvites: pendingInvites.length,
    occupied: members.length + pendingInvites.length,
  };
}

export async function countOccupiedSeats(tenantId: string): Promise<number> {
  const usage = await getSeatUsage(tenantId);
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
