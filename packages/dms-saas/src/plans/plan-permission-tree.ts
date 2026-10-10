import type {
  Permission,
  PermissionTree,
} from "@antelopejs/interface-dms/permissions";

const ID_SEPARATOR = ".";

/** One node of the permission tree the plan editor offers. */
export interface PlanPermissionNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  children?: PlanPermissionNode[];
}

/**
 * The ids a dotted permission id sits under, closest first: `a.b.c` gives
 * `a.b` and `a`.
 */
function permissionAncestors(id: string): string[] {
  const parts = id.split(ID_SEPARATOR);
  return parts
    .slice(1)
    .map((_, position) =>
      parts.slice(0, parts.length - position - 1).join(ID_SEPARATOR),
    );
}

/**
 * A plan's permissions completed with every id they sit under: the DMS counts
 * a permission only when its ancestors are held too, so a plan granting an
 * action without its page would grant nothing. Role saves complete the same
 * way.
 */
export function withPermissionAncestors(permissions: string[]): string[] {
  return [
    ...new Set(permissions.flatMap((id) => [id, ...permissionAncestors(id)])),
  ];
}

function toPlanPermissionNode(
  permission: Permission,
  children: PlanPermissionNode[],
): PlanPermissionNode {
  return {
    id: permission.id,
    label: permission.title ?? permission.id,
    description: permission.description,
    icon: permission.icon,
    children: children.length > 0 ? children : undefined,
  };
}

function mapBranch(
  branch: Record<string, PermissionTree>,
  entryIds: ReadonlySet<string>,
): PlanPermissionNode[] {
  return Object.values(branch).flatMap((node) => mapNode(node, entryIds));
}

function mapNode(
  node: PermissionTree,
  entryIds: ReadonlySet<string>,
): PlanPermissionNode[] {
  if (!node.data) return mapBranch(node.children, entryIds);
  if (node.data.defaultGranted) return liftEntries(node.children, entryIds);
  return [toPlanPermissionNode(node.data, mapBranch(node.children, entryIds))];
}

// Below a permission every member holds, only the menu entries still need a
// grant (the workspace settings under the settings root); the rest is the
// blocks of a page anyone opens.
function liftEntries(
  branch: Record<string, PermissionTree>,
  entryIds: ReadonlySet<string>,
): PlanPermissionNode[] {
  return Object.values(branch).flatMap((node) => {
    if (!node.data) return liftEntries(node.children, entryIds);
    if (!entryIds.has(node.data.id)) return [];
    return mapNode(node, entryIds);
  });
}

/**
 * The registered permission tree as the plan editor offers it, the way the
 * DMS roles editor shows it: a node carrying no permission is skipped and its
 * children lifted, and a `defaultGranted` node is skipped with its blocks
 * while the menu entries filed under it (`entryIds`) are lifted.
 */
export function mapPlanPermissionTree(
  tree: Record<string, PermissionTree>,
  entryIds: ReadonlySet<string>,
): PlanPermissionNode[] {
  return mapBranch(tree, entryIds);
}
