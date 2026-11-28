import { isObject, isText } from '../type-guards'
import {
	SEGMENT_OPERATORS,
	type SegmentCondition,
	type SegmentConditionGroup,
	type SegmentFieldDefinition,
	type SegmentNode,
	type SegmentOperator,
	type SegmentScalar,
	type SegmentScope,
	type SegmentValue,
	type SegmentValueKind,
	type SegmentWorkspaceRef,
	type StoredSegmentRules,
} from './types'

const ISO_DATE_LENGTH = 10
const LIST_OPERATORS: readonly SegmentOperator[] = ['in', 'nin']
const PATH_SEPARATOR = '.'

export function isSegmentGroup(
	node: SegmentNode,
): node is SegmentConditionGroup {
	return 'logical' in node
}

export function isSegmentWorkspaceRef(
	node: SegmentNode,
): node is SegmentWorkspaceRef {
	return 'kind' in node && node.kind === 'workspaceRef'
}

export function isListOperator(operator: SegmentOperator): boolean {
	return LIST_OPERATORS.includes(operator)
}

export function emptySegmentGroup(): SegmentConditionGroup {
	return { logical: 'and', conditions: [] }
}

function isScalar(value: unknown): value is SegmentScalar {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	)
}

function isSegmentValue(value: unknown): value is SegmentValue {
	return (
		value === null ||
		isScalar(value) ||
		(Array.isArray(value) && value.every(isScalar))
	)
}

const OPERATOR_SET: ReadonlySet<string> = new Set(SEGMENT_OPERATORS)

function isOperator(value: unknown): value is SegmentOperator {
	return isText(value) && OPERATOR_SET.has(value)
}

function isSegmentCondition(value: unknown): value is SegmentCondition {
	return (
		isObject(value) &&
		'field' in value &&
		isText(value.field) &&
		'operator' in value &&
		isOperator(value.operator) &&
		'value' in value &&
		isSegmentValue(value.value)
	)
}

function isStoredWorkspaceRef(value: unknown): value is SegmentWorkspaceRef {
	return (
		isObject(value) &&
		'kind' in value &&
		value.kind === 'workspaceRef' &&
		'quantifier' in value &&
		(value.quantifier === 'any' || value.quantifier === 'all') &&
		(!('role' in value) ||
			value.role === undefined ||
			value.role === 'member' ||
			value.role === 'owner') &&
		(!('workspaceNames' in value) ||
			value.workspaceNames === undefined ||
			(Array.isArray(value.workspaceNames) &&
				value.workspaceNames.every(isText))) &&
		'conditions' in value &&
		isStoredGroup(value.conditions)
	)
}

function isStoredNode(value: unknown): value is SegmentNode {
	return (
		isSegmentCondition(value) ||
		isStoredGroup(value) ||
		isStoredWorkspaceRef(value)
	)
}

function isStoredGroup(value: unknown): value is SegmentConditionGroup {
	return (
		isObject(value) &&
		'logical' in value &&
		(value.logical === 'and' || value.logical === 'or') &&
		'conditions' in value &&
		Array.isArray(value.conditions) &&
		value.conditions.every(isStoredNode)
	)
}

function isPartialGroup(
	value: unknown,
): value is Partial<SegmentConditionGroup> {
	return (
		isObject(value) &&
		(!('logical' in value) ||
			value.logical === undefined ||
			value.logical === 'and' ||
			value.logical === 'or') &&
		(!('conditions' in value) ||
			value.conditions === undefined ||
			(Array.isArray(value.conditions) && value.conditions.every(isStoredNode)))
	)
}

function parseJsonGroup(text: string): Partial<SegmentConditionGroup> | null {
	try {
		const parsed: unknown = JSON.parse(text)
		return isPartialGroup(parsed) ? parsed : null
	} catch {
		return null
	}
}

/**
 * The rules from the JSON string or object a field holds, or null when it
 * holds rules this editor cannot read. An empty field is an empty AND group.
 */
export function readSegmentGroup(
	raw: StoredSegmentRules,
): SegmentConditionGroup | null {
	if (raw === null || raw === undefined || raw === '')
		return emptySegmentGroup()
	const group = parseJsonGroup(isText(raw) ? raw : JSON.stringify(raw))
	if (!group) return null
	return {
		logical: group.logical === 'or' ? 'or' : 'and',
		conditions: group.conditions ? [...group.conditions] : [],
	}
}

/** The rules from the JSON string or object a field holds, empty when unreadable. */
export function parseSegmentGroup(
	raw: StoredSegmentRules,
): SegmentConditionGroup {
	return readSegmentGroup(raw) ?? emptySegmentGroup()
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

const DEFAULT_VALUE_BY_KIND: Record<SegmentValueKind, () => SegmentScalar> = {
	number: () => 0,
	boolean: () => true,
	date: () => new Date().toISOString().slice(0, ISO_DATE_LENGTH),
	string: () => '',
}

/** The value a rule starts with for a field and an operator. */
export function defaultSegmentValue(
	field: SegmentFieldDefinition | undefined,
	operator: SegmentOperator,
): SegmentValue {
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
	value: SegmentValue,
	operator: SegmentOperator,
): SegmentValue {
	if (isListOperator(operator)) {
		if (Array.isArray(value)) return value
		return value === '' || value === null ? [] : [value]
	}
	return Array.isArray(value) ? (value[0] ?? '') : value
}
