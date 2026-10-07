/** A plan as the retire dialog names it. */
export interface RetirePlanSummary {
	_id: string
	name: string
	slug: string
	price: number
	currency: string
	interval: 'month' | 'year'
	billingMode: 'flat' | 'seat'
	maxMembers: number
}

/** One workspace on the plan being retired. */
export interface RetireWorkspace {
	tenantId: string
	name: string
	members: number
	status: string
	renewsAt: string | null
}

/** Step 1: who is on the plan, and what they pay. */
export interface RetireImpact {
	plan: RetirePlanSummary
	workspaces: number
	paying: number
	pastDue: number
	members: number
	mrr: number
	firstRenewal: string | null
	lastRenewal: string | null
	rows: RetireWorkspace[]
	targets: RetirePlanSummary[]
	hasOpenMigration: boolean
}

export type PlanChangeKind = 'lost' | 'gained' | 'changed' | 'same'

/** One feature compared between the plan left and the plan joined. */
export interface RetireFeatureChange {
	featureId: string
	from: unknown
	to: unknown
	kind: PlanChangeKind
}

/** Step 2: what changes for the workspaces, and who is told. */
export interface RetirePreparation {
	target: RetirePlanSummary
	features: RetireFeatureChange[]
	members: { from: number; to: number; kind: PlanChangeKind; above: number }
	price: { kind: PlanChangeKind }
	permissions: Array<{ id: string; kind: PlanChangeKind }>
	recipients: number
	sample: { workspaceName: string; members: number } | null
}

export const RETIRE_ENDPOINT = '/api/saas/plans-deletion'
export const MIGRATIONS_PAGE_URL = '/modules/saas/catalog/plan-migrations'

/** The changes worth a line of their own: everything but what stays the same. */
export function changedFeatures(
	changes: RetireFeatureChange[],
): RetireFeatureChange[] {
	const order: Record<PlanChangeKind, number> = {
		lost: 0,
		changed: 1,
		gained: 2,
		same: 3,
	}
	return changes
		.filter((change) => change.kind !== 'same')
		.sort((left, right) => order[left.kind] - order[right.kind])
}

/** The features that stay the same, named on one line. */
export function unchangedFeatureIds(changes: RetireFeatureChange[]): string[] {
	return changes
		.filter((change) => change.kind === 'same' && change.from !== null)
		.map((change) => change.featureId)
}
