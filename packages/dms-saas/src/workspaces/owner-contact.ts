import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
} from "@antelopejs/interface-dms/db";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";

/** Who a member asks when the workspace needs its owner (an unpaid invoice). */
export interface WorkspaceOwnerContact {
  name: string;
  email: string;
}

function toContact(user: User): WorkspaceOwnerContact {
  return { name: user.name || user.email, email: user.email };
}

/**
 * Every owner among `members`, as members see them named: by name, else by
 * e-mail.
 *
 * @param members Members of the workspace
 */
export async function listWorkspaceOwnerContacts(
  members: TenantMember[],
): Promise<WorkspaceOwnerContact[]> {
  const users = await Promise.all(
    members
      .filter((member) => member.isTenantOwner)
      .map((owner) => GetModel(UserModel).get(owner.userId)),
  );
  return users.flatMap((user) => (user ? [toContact(user)] : []));
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
  return user ? toContact(user) : null;
}
