import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";

/** Who asks, and in which workspace: a layout banner's or a filter's context. */
export interface WorkspaceRequestContext {
  /** Undefined for an unauthenticated request. */
  user: User | undefined;
  tenantId: string;
}

/** Whether the user is an owner of the workspace. */
export async function isWorkspaceOwner(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const membership = await GetModel(TenantMemberModel, tenantId).getByUser(
    userId,
  );
  return !!membership?.isTenantOwner;
}

/** Whether the request comes from an owner of the workspace. */
export async function isWorkspaceOwnerRequest({
  user,
  tenantId,
}: WorkspaceRequestContext): Promise<boolean> {
  return !!user && isWorkspaceOwner(user._id, tenantId);
}
