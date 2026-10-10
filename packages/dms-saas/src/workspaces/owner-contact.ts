import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";

/** Who a member asks when the workspace needs its owner (an unpaid invoice). */
export interface WorkspaceOwnerContact {
  name: string;
  email: string;
}

/**
 * The first workspace owner who joined, as members see them named on billing
 * notices; null for a workspace whose owner never accepted the invitation.
 *
 * @param tenantId Workspace to look the owner up in
 */
export async function findWorkspaceOwnerContact(
  tenantId: string,
): Promise<WorkspaceOwnerContact | null> {
  const [owner] = await GetModel(TenantMemberModel, tenantId).listOwners();
  if (!owner) return null;
  const user = await GetModel(UserModel).get(owner.userId);
  if (!user) return null;
  return { name: user.name || user.email, email: user.email };
}
