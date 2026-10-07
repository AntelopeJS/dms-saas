/** Where one captured workspace stands in a migration. */
export type MigrationWorkspaceStatus =
	| 'pending'
	| 'running'
	| 'succeeded'
	| 'reconciliation_required'
	| 'failed'
	| 'kept'

/** One captured workspace, as the migration detail lists it. */
export interface MigrationWorkspace {
	tenantId: string
	name: string
	status: MigrationWorkspaceStatus
	error: string | null
	attempt: number
	updatedAt: string | null
	isUncertain: boolean
}

/** Everything the migration detail shows. */
export interface MigrationDetail {
	_id: string
	status: string
	reason: string | null
	from: { _id: string; name: string }
	to: { _id: string; name: string }
	createdAt: string
	completedAt: string | null
	startedBy: string
	notifyMembers: boolean
	totals: {
		captured: number
		moved: number
		notMoved: number
		uncertain: number
		failed: number
		notified: number
	}
	abilities: { canRetry: boolean; canReconcile: boolean; canResolve: boolean }
	permissions: { added: string[]; removed: string[] }
	reconciliation: { at: string; by: string; note: string } | null
	workspaces: MigrationWorkspace[]
}

/** Which plan Stripe bills a workspace on, next to the DMS's. */
export interface StripeReading {
	stripeSubscriptionId: string | null
	stripePlan: 'source' | 'target' | 'other' | 'none' | 'unavailable'
	stripePlanName: string | null
	dmsPlanName: string | null
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

/** One colour per workspace outcome, in the migration family's spirit. */
export const WORKSPACE_STATUS_TONES: Record<MigrationWorkspaceStatus, Tone> = {
	pending: 'neutral',
	running: 'info',
	succeeded: 'success',
	reconciliation_required: 'error',
	failed: 'warning',
	kept: 'neutral',
}

const LIVE_STATUSES = new Set(['pending', 'running'])

/** Whether a migration still moves workspaces (the detail refreshes then). */
export function isMigrationLive(status: string): boolean {
	return LIVE_STATUSES.has(status)
}

/** The workspaces an operator must look at: uncertain, then failed. */
export function attentionWorkspaces(
	workspaces: MigrationWorkspace[],
): MigrationWorkspace[] {
	return workspaces.filter((row) => row.isUncertain || row.status === 'failed')
}
