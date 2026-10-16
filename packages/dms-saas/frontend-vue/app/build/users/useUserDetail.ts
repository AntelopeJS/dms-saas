import { computed, type ComputedRef } from 'vue'
import type { DmsAsyncData } from '#dms/frontend-module'

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

/** A stored image, as the DMS image type writes it. */
export interface UserAvatar {
	key: string
}

/** What `GET /api/saas/users/:id` answers. */
export interface UserDetail {
	_id: string
	name: string
	email: string
	avatar: UserAvatar | null
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

export interface UserDetailRequest extends DmsAsyncData<UserDetail> {
	userId: ComputedRef<string>
	isLoading: ComputedRef<boolean>
}

/**
 * The user a platform admin's user page shows, fetched once for the header
 * and the platform role card, and again when the page moves to another user.
 */
export function useUserDetail(
	routeParams: () => Record<string, string> | undefined,
): UserDetailRequest {
	const userId = computed(() => routeParams()?.id ?? '')
	const request = useApiData<UserDetail>(() =>
		userId.value ? `/api/saas/users/${userId.value}` : null,
	)
	return {
		...request,
		userId,
		isLoading: computed(
			() => !request.data.value && request.status.value !== 'error',
		),
	}
}

/** The user's display name: their name, or their address without one. */
export function userDisplayName(
	user: Pick<UserDetail, 'name' | 'email'>,
): string {
	return user.name || user.email
}
