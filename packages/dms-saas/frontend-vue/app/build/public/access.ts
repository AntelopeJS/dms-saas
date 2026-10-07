export type AccessBlockReason =
	| 'suspended'
	| 'pending_payment'
	| 'cancelled'
	| 'complimentary_expired'

export type AccessTimelineKind =
	| 'invoice_issued'
	| 'payment_failed'
	| 'complimentary_ended'
	| 'suspended'
	| 'awaiting_payment'
	| 'cancelled'
	| 'data_deleted'

export interface AccessTimelineEntry {
	kind: AccessTimelineKind
	at: string
	isUpcoming: boolean
}

export interface WorkspaceOwnerContact {
	name: string | null
	email: string
}

export interface OtherWorkspace {
	_id: string
	name: string
	planName: string | null
	status: string | null
	isTenantOwner: boolean
}

export interface UnpaidInvoiceRef {
	number: string | null
	amount: number
	currency: string
	hostedInvoiceUrl: string | null
}

export interface BlockedWorkspaceSummary {
	_id: string
	name: string
	planName: string | null
	memberCount: number
}

/** `GET /api/saas/workspace-access`. */
export interface WorkspaceAccessDetails {
	blocked: boolean
	reason: AccessBlockReason | null
	workspace: BlockedWorkspaceSummary
	isTenantOwner: boolean
	owners: WorkspaceOwnerContact[]
	unpaidInvoice: UnpaidInvoiceRef | null
	canManageInStripe: boolean
	timeline: AccessTimelineEntry[]
	dataDeletionAt: string | null
	otherWorkspaces: OtherWorkspace[]
}

export interface AccessReasonView {
	/** Status the pill shows, from the workspace status vocabulary. */
	status: string
	icon: string
}

/** The status pill and icon of each reason. */
export const ACCESS_REASON_VIEWS: Record<AccessBlockReason, AccessReasonView> =
	{
		suspended: { status: 'suspended', icon: 'i-ph-lock-simple' },
		pending_payment: { status: 'pending_payment', icon: 'i-ph-hourglass' },
		cancelled: { status: 'cancelled', icon: 'i-ph-archive' },
		complimentary_expired: { status: 'suspended', icon: 'i-ph-gift' },
	}

export interface TimelineStepView {
	icon: string
	tone: 'neutral' | 'warning' | 'error'
}

export const TIMELINE_STEP_VIEWS: Record<AccessTimelineKind, TimelineStepView> =
	{
		invoice_issued: { icon: 'i-ph-receipt', tone: 'neutral' },
		payment_failed: { icon: 'i-ph-credit-card', tone: 'error' },
		complimentary_ended: { icon: 'i-ph-gift', tone: 'warning' },
		suspended: { icon: 'i-ph-lock-simple', tone: 'error' },
		awaiting_payment: { icon: 'i-ph-hourglass', tone: 'warning' },
		cancelled: { icon: 'i-ph-archive', tone: 'neutral' },
		data_deleted: { icon: 'i-ph-trash', tone: 'error' },
	}

const INITIALS_LENGTH = 2
const MS_PER_DAY = 86_400_000
const WORD_SEPARATOR = /\s+/

/** Two letters for a workspace tile: "Northwind Traders" reads "NT". */
export function workspaceInitials(name: string): string {
	const words = name.trim().split(WORD_SEPARATOR).filter(Boolean)
	const letters =
		words.length >= INITIALS_LENGTH
			? words.slice(0, INITIALS_LENGTH).map((word) => word[0])
			: [...(words[0] ?? '')].slice(0, INITIALS_LENGTH)
	return letters.join('').toUpperCase()
}

/** Whole days from `now` until `date`, never negative. */
export function daysUntil(date: string, now = new Date()): number {
	return Math.max(
		0,
		Math.ceil((new Date(date).getTime() - now.getTime()) / MS_PER_DAY),
	)
}
