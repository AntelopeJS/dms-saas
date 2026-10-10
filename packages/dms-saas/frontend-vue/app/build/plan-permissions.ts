/** One node of the permission tree the plan editor offers. */
export interface PermissionNode {
	id: string
	label: string
	description?: string
	icon?: string
	children?: PermissionNode[]
}

/** A node placed in its tree: its depth, ancestors and descendants. */
export interface PermissionRow {
	node: PermissionNode
	depth: number
	groupId: string
	ancestors: string[]
	descendants: string[]
}

function descendantIds(node: PermissionNode): string[] {
	return (node.children ?? []).flatMap((child) => [
		child.id,
		...descendantIds(child),
	])
}

function placeNodes(
	nodes: PermissionNode[],
	ancestors: string[],
	groupId: string | null,
): PermissionRow[] {
	return nodes.flatMap((node) => {
		const group = groupId ?? node.id
		const row: PermissionRow = {
			node,
			depth: ancestors.length,
			groupId: group,
			ancestors,
			descendants: descendantIds(node),
		}
		return [
			row,
			...placeNodes(node.children ?? [], [...ancestors, node.id], group),
		]
	})
}

/** Every node of the tree in display order, each with its place. */
export function flattenPermissionTree(tree: PermissionNode[]): PermissionRow[] {
	return placeNodes(tree, [], null)
}

/**
 * Ticks a node: it brings its descendants (the actions of a page) and its
 * ancestors (the page holding an action), as the roles editor does.
 */
export function grantPermission(
	granted: Set<string>,
	row: PermissionRow,
): Set<string> {
	return new Set([
		...granted,
		row.node.id,
		...row.descendants,
		...row.ancestors,
	])
}

/** Unticks a node and what lies under it; its ancestors stay. */
export function revokePermission(
	granted: Set<string>,
	row: PermissionRow,
): Set<string> {
	const removed = new Set([row.node.id, ...row.descendants])
	return new Set([...granted].filter((id) => !removed.has(id)))
}

/** Whether a row, or one of its descendants, matches a search. */
export function matchesSearch(
	row: PermissionRow,
	rows: PermissionRow[],
	query: string,
	labelOf: (node: PermissionNode) => string,
): boolean {
	if (!query) return true
	const needle = query.toLowerCase()
	const candidates = [row.node.id, ...row.descendants]
	return rows.some(
		(other) =>
			candidates.includes(other.node.id) &&
			labelOf(other.node).toLowerCase().includes(needle),
	)
}
