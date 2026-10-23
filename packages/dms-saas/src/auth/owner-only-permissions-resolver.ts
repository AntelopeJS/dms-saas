import {
  type PermissionsResolverContext,
  RegisterPermissionsResolver,
} from "@antelopejs/interface-dms/permissions-resolver";
import { ownerOnlyPermissionIds } from "../pages/tenant/owner-only";
import { isWorkspaceOwner } from "../workspaces/workspace-owner";

const RESOLVER_ID = "dms-saas.owner-only-surfaces";
// After the plan intersection: it may hand an owner the plan's permissions,
// which this one then never has to withhold.
const RESOLVER_ORDER = 110;
const ALL_PERMISSIONS = "*";

async function withholdOwnerOnlySurfaces(
  userId: string,
  tenantId: string,
  current: Set<string>,
  context: PermissionsResolverContext,
): Promise<Set<string>> {
  if (current.has(ALL_PERMISSIONS)) return current;
  // A previewed role is held by a member, never by the owner.
  const isOwner =
    !context.preview && (await isWorkspaceOwner(userId, tenantId));
  if (isOwner) return current;
  const withheld = new Set(ownerOnlyPermissionIds());
  return new Set([...current].filter((id) => !withheld.has(id)));
}

/**
 * Withhold the owner-only surfaces from every other member, even through a
 * role granting everything, so the menu, the pages and the guards agree.
 */
export function registerOwnerOnlyPermissionsResolver(): void {
  RegisterPermissionsResolver({
    id: RESOLVER_ID,
    order: RESOLVER_ORDER,
    resolver: withholdOwnerOnlySurfaces,
  });
}
