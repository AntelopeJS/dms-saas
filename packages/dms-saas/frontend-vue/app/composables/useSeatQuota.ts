const SEAT_QUOTA_ENDPOINT = '/api/saas/tenant/seats'
const SEAT_QUOTA_STATE_KEY = 'saas-seat-quota'

export interface PlatformSupportMember {
	userId: string
	name: string
	email: string
}

/** A workspace owner a member is told to ask for more seats. */
export interface SeatOwnerContact {
	name: string
	email: string
}

export interface SeatQuotaResponse {
	members: number
	pendingInvites: number
	occupied: number
	/** `null` when no plan caps the seats. */
	maxMembers: number | null
	planName: string | null
	/** The first plan on sale with more seats, if any. */
	upgradePlanName: string | null
	isTenantOwner: boolean
	owners: SeatOwnerContact[]
	/** Platform owners with access to the workspace; they hold no seat. */
	platformSupport: PlatformSupportMember[]
}

export function useSeatQuota(): SharedRequest<SeatQuotaResponse> {
	const { $authFetch } = useAuthFetch()
	return useSharedRequest(SEAT_QUOTA_STATE_KEY, () =>
		$authFetch<SeatQuotaResponse>(SEAT_QUOTA_ENDPOINT),
	)
}
