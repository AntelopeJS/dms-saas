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
const STATE_KEY = 'saas-my-workspaces'

interface MyWorkspacesHandle {
	workspaces: Ref<MyWorkspace[]>
	isLoaded: Ref<boolean>
	refresh: () => Promise<void>
}

/**
 * Shared between the sidebar switcher and the screens that change what it
 * displays (a rename, a deletion), so a change never waits for a page reload.
 */
export function useMyWorkspaces(): MyWorkspacesHandle {
	const { $authFetch } = useAuthFetch()
	const { loggedIn } = useUserSession()
	const workspaces = useDmsState<MyWorkspace[]>(STATE_KEY, () => [])
	const isLoaded = useDmsState<boolean>(`${STATE_KEY}-loaded`, () => false)

	async function refresh(): Promise<void> {
		if (!loggedIn.value) {
			workspaces.value = []
			isLoaded.value = true
			return
		}

		try {
			workspaces.value = await $authFetch<MyWorkspace[]>(WORKSPACES_ENDPOINT)
			isLoaded.value = true
		} catch (error) {
			// Only the initial load may empty the list — a failed refresh keeps
			// the entries already on screen rather than making the switcher
			// disappear.
			if (!isLoaded.value) workspaces.value = []
			throw error
		}
	}

	return { workspaces, isLoaded, refresh }
}
