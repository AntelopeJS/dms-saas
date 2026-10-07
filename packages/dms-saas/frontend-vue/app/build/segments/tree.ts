import type {
	SegmentCondition,
	SegmentConditionGroup,
	SegmentFieldDefinition,
	SegmentNode,
	SegmentOperator,
	SegmentScope,
	SegmentValueKind,
	SegmentWorkspaceRef,
} from './types'

const ISO_DATE_LENGTH = 10
const LIST_OPERATORS: readonly SegmentOperator[] = ['in', 'nin']
const PATH_SEPARATOR = '.'

export function isSegmentGroup(
	node: SegmentNode,
): node is SegmentConditionGroup {
	return (node as SegmentConditionGroup).logical !== undefined
}

export function isSegmentWorkspaceRef(
	node: SegmentNode,
): node is SegmentWorkspaceRef {
	return (node as SegmentWorkspaceRef).kind === 'workspaceRef'
}

export function isListOperator(operator: SegmentOperator): boolean {
	return LIST_OPERATORS.includes(operator)
}

export function emptySegmentGroup(): SegmentConditionGroup {
	return { logical: 'and', conditions: [] }
}

/** The rules from the JSON string or object a field holds. */
export function parseSegmentGroup(raw: unknown): SegmentConditionGroup {
	let value: unknown = raw
	if (typeof raw === 'string') {
		try {
			value = raw ? JSON.parse(raw) : null
		} catch {
			value = null
		}
	}
	const group = value as Partial<SegmentConditionGroup> | null
	return {
		logical: group?.logical === 'or' ? 'or' : 'and',
		conditions: Array.isArray(group?.conditions) ? [...group.conditions] : [],
	}
}

/** The path of the child at `index` of the node at `parent` ("1.2"). */
export function childPath(parent: string, index: number): string {
	return parent ? `${parent}${PATH_SEPARATOR}${index}` : String(index)
}

/** A node found by its path, with the fields its level reads. */
export interface SegmentPlacedNode {
	node: SegmentNode
	scope: SegmentScope
}

function childrenOf(node: SegmentNode): SegmentNode[] {
	if (isSegmentWorkspaceRef(node)) return node.conditions.conditions
	if (isSegmentGroup(node)) return node.conditions
	return []
}

/** The node at a path of the rules ("1.0"), or null when it is gone. */
export function findSegmentNode(
	group: SegmentConditionGroup,
	path: string,
): SegmentPlacedNode | null {
	let placed: SegmentPlacedNode = { node: group, scope: 'user' }
	for (const index of path.split(PATH_SEPARATOR).map(Number)) {
		const next = childrenOf(placed.node)[index]
		if (!next) return null
		const scope = isSegmentWorkspaceRef(placed.node)
			? 'workspace'
			: placed.scope
		placed = { node: next, scope }
	}
	return placed
}

/** Whether a tree holds at least one condition, at any depth. */
export function hasSegmentConditions(group: SegmentConditionGroup): boolean {
	return group.conditions.some((node) => {
		if (isSegmentWorkspaceRef(node)) return true
		if (isSegmentGroup(node)) return hasSegmentConditions(node)
		return true
	})
}

const DEFAULT_VALUE_BY_KIND: Record<SegmentValueKind, () => unknown> = {
	number: () => 0,
	boolean: () => true,
	date: () => new Date().toISOString().slice(0, ISO_DATE_LENGTH),
	string: () => '',
}

/** The value a rule starts with for a field and an operator. */
export function defaultSegmentValue(
	field: SegmentFieldDefinition | undefined,
	operator: SegmentOperator,
): unknown {
	if (isListOperator(operator)) return []
	if (!field) return ''
	const firstOption = field.enumOptions?.[0]?.value
	if (firstOption !== undefined) return firstOption
	return DEFAULT_VALUE_BY_KIND[field.valueKind]()
}

/** A new rule reading `field`, on its first operator. */
export function newSegmentCondition(
	field: SegmentFieldDefinition | undefined,
): SegmentCondition {
	const operator = field?.operators[0] ?? 'eq'
	return {
		field: field?.id ?? '',
		operator,
		value: defaultSegmentValue(field, operator),
	}
}

/** The value kept when a rule moves between a single and a list operator. */
export function adaptSegmentValue(
	value: unknown,
	operator: SegmentOperator,
): unknown {
	if (isListOperator(operator)) {
		if (Array.isArray(value)) return value
		return value === '' || value === null || value === undefined ? [] : [value]
	}
	return Array.isArray(value) ? (value[0] ?? '') : value
}
