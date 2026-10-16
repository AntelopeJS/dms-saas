import { computed, type ComputedRef } from 'vue'

/** One workspace of the switcher, as `GET /api/saas/workspaces/mine` answers it. */
export interface MyWorkspace {
	_id: string
	name: string
	planName: string | null
	/** Billing state (`active`, `trialing`, `free`, `past_due`…). */
	status: string
	isComplimentary: boolean
	membersCount: number
	/** The first workspace owner's name. */
	ownerName: string | null
	/** Whether the caller owns the workspace. */
	isOwner: boolean
	isCurrent: boolean
}

const WORKSPACES_ENDPOINT = '/api/saas/workspaces/mine'

interface MyWorkspacesHandle {
	/** Empty until the list is in, and for a visitor without a session. */
	workspaces: ComputedRef<MyWorkspace[]>
	isLoaded: ComputedRef<boolean>
	/** The last read failed; the entries already on screen stay. */
	hasFailed: ComputedRef<boolean>
	refresh: () => Promise<void>
}

/**
 * Shared between the sidebar switcher and the screens that change what it
 * displays (a deletion; a rename reads it again with the rest of the page),
 * so a change never waits for a page reload.
 * Nothing is read without a session: the public layouts mount the switcher's
 * readers too.
 */
export function useMyWorkspaces(): MyWorkspacesHandle {
	const { loggedIn } = useDmsUserSession()
	const { data, status, refresh } = useApiData<MyWorkspace[]>(() =>
		loggedIn.value ? WORKSPACES_ENDPOINT : null,
	)
	const workspaces = computed(() => data.value ?? [])
	return {
		workspaces,
		isLoaded: computed(
			() =>
				!loggedIn.value ||
				status.value === 'success' ||
				workspaces.value.length > 0,
		),
		hasFailed: computed(() => status.value === 'error'),
		refresh: () => refresh(),
	}
}
