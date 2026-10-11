import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { SessionModel, type User } from "@antelopejs/interface-dms/auth/db";
import { PlanModel } from "../db";
import {
  buildUserProjection,
  loadWorkspaceProjection,
  type UserMembership,
  type UserProjection,
} from "./segment-matching";

function latestSessionActivity(
  sessions: readonly { lastActiveAt?: Date | null }[],
): Date | undefined {
  return sessions
    .map((session) => session.lastActiveAt)
    .filter((date): date is Date => !!date)
    .map((date) => new Date(date))
    .sort((a, b) => b.getTime() - a.getTime())[0];
}

/**
 * The projection of one user, reading only their own workspaces: what a
 * segment sees of them, to explain why they belong to it.
 */
export async function loadUserProjection(
  user: User,
  now: Date = new Date(),
): Promise<UserProjection> {
  const memberRows = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(user._id);
  const memberships: UserMembership[] = memberRows.map((row) => ({
    tenantId: row.tenantId,
    isTenantOwner: !!row.member.isTenantOwner,
  }));
  const [tenants, sessions] = await Promise.all([
    GetModel(TenantModel).getMany(memberships.map((m) => m.tenantId)),
    GetModel(SessionModel).getByUserId(user._id),
  ]);
  const planModel = GetModel(PlanModel);
  const workspaces = await Promise.all(
    tenants.map((tenant) => loadWorkspaceProjection(tenant, planModel, now)),
  );
  return buildUserProjection(
    user,
    memberships,
    latestSessionActivity(sessions),
    new Map(workspaces.map((workspace) => [workspace._id, workspace])),
    now,
  );
}
