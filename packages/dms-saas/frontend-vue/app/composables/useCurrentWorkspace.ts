export interface CurrentWorkspace {
	_id: string
	name: string
	retentionDays: number
}

const CURRENT_ENDPOINT = '/api/saas/workspaces/current'
const STATE_KEY = 'saas-current-workspace'

interface CurrentWorkspaceHandle {
	workspace: Ref<CurrentWorkspace | null>
	load: () => Promise<void>
}

/**
 * The current workspace's identity, read once and shared by the blocks that
 * show it (the plan card names it in its deletion copy).
 */
export function useCurrentWorkspace(): CurrentWorkspaceHandle {
	const { $authFetch } = useAuthFetch()
	const workspace = useDmsState<CurrentWorkspace | null>(STATE_KEY, () => null)

	async function load(): Promise<void> {
		workspace.value = await $authFetch<CurrentWorkspace>(CURRENT_ENDPOINT)
	}

	return { workspace, load }
}
