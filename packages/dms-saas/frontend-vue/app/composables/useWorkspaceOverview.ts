const OVERVIEW_ENDPOINT = '/api/saas/workspaces/current/overview'
const OVERVIEW_STATE_KEY = 'saas-workspace-overview'

/** Seats as the members page counts them; `maxMembers` null when unlimited. */
export interface WorkspaceSeatsOverview {
	members: number
	pendingInvites: number
	occupied: number
	maxMembers: number | null
}

export interface WorkspacePlanOverview {
	name: string
	/** Billing state of the workspace. */
	status: string
	isComplimentary: boolean
	/** Minor units. */
	price: number
	currency: string
	interval: PlanInterval
	billingMode: PlanBillingMode
	renewsAt: string | null
}

export interface WorkspaceOwnerOverview {
	userId: string
	name: string
	email: string
	isCaller: boolean
}

export interface NextWorkspaceRef {
	_id: string
	name: string
}

/** `GET /api/saas/workspaces/current/overview`, read by the General page. */
export interface WorkspaceOverview {
	_id: string
	name: string
	createdAt: string
	seats: WorkspaceSeatsOverview
	plan: WorkspacePlanOverview | null
	owners: WorkspaceOwnerOverview[]
	invoicesCount: number
	unpaidInvoiceNumber: string | null
	retentionDays: number
	destroyedAt: string
	nextWorkspace: NextWorkspaceRef | null
}

/** What the General page's danger zone states about deleting the workspace. */
export function useWorkspaceOverview(): SharedRequest<WorkspaceOverview> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(OVERVIEW_STATE_KEY, () =>
		$authFetch<WorkspaceOverview>(OVERVIEW_ENDPOINT),
	)
}
