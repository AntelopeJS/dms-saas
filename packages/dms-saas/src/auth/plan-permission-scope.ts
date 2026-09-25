import type { PermissionTree } from "@antelopejs/interface-dms/permissions";

const ALL_PERMISSIONS = "*";
const ID_SEPARATOR = ".";

/**
 * What a plan leaves reachable, as two id sets.
 *
 * `subtrees` holds ids granted together with every id nested under them;
 * `exact` holds ids granted on their own.
 */
export interface PlanPermissionScope {
  subtrees: ReadonlySet<string>;
  exact: ReadonlySet<string>;
}

/**
 * Whether a plan's scope leaves `permissionId` reachable.
 *
 * DMS builds component and action ids by suffixing the page id
 * (`settings.user.members` → `settings.user.members.table.view`), so a
 * subtree root reaches its page's components by walking up the id.
 */
export function isInPlanScope(
  permissionId: string,
  scope: PlanPermissionScope,
): boolean {
  if (scope.subtrees.has(ALL_PERMISSIONS)) return true;
  if (scope.exact.has(permissionId)) return true;
  let ancestor = permissionId;
  for (;;) {
    if (scope.subtrees.has(ancestor)) return true;
    const separatorIndex = ancestor.lastIndexOf(ID_SEPARATOR);
    if (separatorIndex <= 0) return false;
    ancestor = ancestor.slice(0, separatorIndex);
  }
}

/** Every permission id registered in a DMS permission tree. */
export function listRegisteredPermissionIds(
  tree: Record<string, PermissionTree>,
): string[] {
  return Object.values(tree).flatMap((node) => [
    ...(node.data ? [node.data.id] : []),
    ...listRegisteredPermissionIds(node.children),
  ]);
}

/**
 * The ids a scope grants outright: the registered ids it reaches plus its own
 * roots, which a plan may name before any module registers them.
 *
 * DMS matches permission ids exactly, so a subtree has to be spelled out id by
 * id before a permission set can grant it. The wildcard is never handed out:
 * it would read as platform ownership, module pages included.
 */
export function listScopeGrants(
  scope: PlanPermissionScope,
  registeredIds: readonly string[],
): Set<string> {
  const grants = new Set([
    ...registeredIds.filter((id) => isInPlanScope(id, scope)),
    ...scope.subtrees,
    ...scope.exact,
  ]);
  grants.delete(ALL_PERMISSIONS);
  return grants;
}
