import { computed, type ComputedRef } from 'vue'
import type { SharedRequest } from '../../composables/useSharedRequest'

/** A workspace of the user, with their place in it. */
export interface UserWorkspace {
	tenantId: string
	name: string
	isTenantOwner: boolean
	joinedAt: string | null
}

export interface MoneyTotal {
	currency: string
	amount: number
}

export interface UserSecurity {
	signInMethods: string[]
	twoFactorMethods: string[]
	backupCodesLeft: number | null
	activeSessions: number
	sessionLocations: string[]
	isEmailVerified: boolean
	verificationRequestedAt: string | null
}

/** What `GET /api/saas/users/:id` answers. */
export interface UserDetail {
	_id: string
	name: string
	email: string
	avatar: { key: string } | string | null
	language: string | null
	createdAt: string
	lastActiveAt: string | null
	lastSession: { browser: string; os: string; location: string } | null
	isPlatformAdmin: boolean
	isSelf: boolean
	workspaces: UserWorkspace[]
	billedAsOwner: MoneyTotal[]
	segmentCount: number
	security: UserSecurity
}

export interface UserDetailRequest extends SharedRequest<UserDetail> {
	userId: ComputedRef<string>
	isLoading: ComputedRef<boolean>
}

const STATE_KEY = 'saas-user-detail'

/**
 * The user a platform admin's user page shows, fetched once for the header,
 * the security card and the platform role card.
 */
export function useUserDetail(
	routeParams: () => Record<string, string> | undefined,
): UserDetailRequest {
	const { $authFetch } = useAuthFetch()
	const userId = computed(() => routeParams()?.id ?? '')
	const request = useSharedRequest<UserDetail>(
		`${STATE_KEY}:${userId.value}`,
		() => $authFetch<UserDetail>(`/api/saas/users/${userId.value}`),
	)
	return {
		...request,
		userId,
		isLoading: computed(() => !request.data.value && !request.error.value),
	}
}

/** The user's display name: their name, or their address without one. */
export function userDisplayName(
	user: Pick<UserDetail, 'name' | 'email'>,
): string {
	return user.name || user.email
}
