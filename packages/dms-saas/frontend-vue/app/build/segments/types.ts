export const SEGMENT_OPERATORS = [
	'eq',
	'neq',
	'gt',
	'gte',
	'lt',
	'lte',
	'in',
	'nin',
	'contains',
] as const

export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number]

export type SegmentLogical = 'and' | 'or'
export type SegmentQuantifier = 'any' | 'all'
export type SegmentMemberRole = 'member' | 'owner'
export type SegmentValueKind = 'string' | 'number' | 'boolean' | 'date'
export type SegmentFieldType =
	| 'string'
	| 'number'
	| 'boolean'
	| 'date'
	| 'enum'
	| 'enum:plan'
export type SegmentFieldUnit = 'currency' | 'days' | 'count'

/** One value of an enum field, as the server names it. */
export interface SegmentEnumOption {
	value: string
	labelKey: string
	tone?: string
}

/** A field a rule reads, as `GET /api/saas/segments/fields` lists it. */
export interface SegmentFieldDefinition {
	id: string
	type: SegmentFieldType
	valueKind: SegmentValueKind
	labelKey: string
	descriptionKey: string
	operators: readonly SegmentOperator[]
	group: string
	icon: string
	enumOptions?: readonly SegmentEnumOption[]
	unit?: SegmentFieldUnit
}

export interface SegmentPlanOption {
	_id: string
	name: string
	currency: string
}

/** The fields catalog the server answers. */
export interface SegmentFieldsCatalog {
	fields: SegmentFieldDefinition[]
	userFields: SegmentFieldDefinition[]
	plans: SegmentPlanOption[]
}

/** Which fields a level of the rules reads: a user's, or a workspace's. */
export type SegmentScope = 'user' | 'workspace'

/** One value a rule compares a field to. */
export type SegmentScalar = string | number | boolean

/** What a rule compares a field to: one value, or the list of `in` / `nin`. */
export type SegmentValue = SegmentScalar | SegmentScalar[] | null

export interface SegmentCondition {
	field: string
	operator: SegmentOperator
	value: SegmentValue
}

export interface SegmentWorkspaceRef {
	kind: 'workspaceRef'
	quantifier: SegmentQuantifier
	role?: SegmentMemberRole
	conditions: SegmentConditionGroup
	/** Set on an explanation: the user's workspaces meeting the rules. */
	workspaceNames?: string[]
}

export interface SegmentConditionGroup {
	logical: SegmentLogical
	conditions: SegmentNode[]
}

export type SegmentNode =
	| SegmentCondition
	| SegmentConditionGroup
	| SegmentWorkspaceRef

/** Rules as a field stores them: the JSON string, or the group itself. */
export type StoredSegmentRules =
	| string
	| SegmentConditionGroup
	| null
	| undefined

/** A user a preview names among its matches. */
export interface SegmentPreviewUser {
	_id: string
	name: string
	email: string
	workspaceName: string | null
	isAdded: boolean
}

/** What `POST /api/saas/segments/preview` answers. */
export interface SegmentPreview {
	matchCount: number
	totalUsers: number
	savedCount: number | null
	addedCount: number
	removedCount: number
	nodeCounts: Record<string, number>
	signals: { path: string; count: number }[]
	universalPaths: string[]
	sample: SegmentPreviewUser[]
	savedEvaluatedAt: string | null
	evaluatedAt: string
	durationMs: number
}

/** A piece of a rule read in words: plain text, or a value pill. */
export interface SegmentWordToken {
	text: string
	/** Drawn as a pill in this tone; plain text without one. */
	tone?: string
	/** Drawn in bold: the field a rule reads. */
	isStrong?: boolean
}
