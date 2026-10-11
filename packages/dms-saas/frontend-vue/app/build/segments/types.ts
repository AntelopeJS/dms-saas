export type SegmentOperator =
	| 'eq'
	| 'neq'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'in'
	| 'nin'
	| 'contains'

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

export interface SegmentCondition {
	field: string
	operator: SegmentOperator
	value: unknown
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
