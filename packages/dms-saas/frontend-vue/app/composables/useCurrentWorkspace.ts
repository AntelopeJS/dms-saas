export interface CurrentWorkspace {
	_id: string
	name: string
	retentionDays: number
}

const CURRENT_ENDPOINT = '/api/saas/workspaces/current'

interface CurrentWorkspaceHandle {
	workspace: Readonly<Ref<CurrentWorkspace | null>>
	load: () => Promise<void>
}

/**
 * The current workspace's identity, read when a dialog needs it (the plan
 * card names it in its cancellation copy).
 */
export function useCurrentWorkspace(): CurrentWorkspaceHandle {
	const current = useOnDemandRead<CurrentWorkspace>(() => CURRENT_ENDPOINT)

	async function load(): Promise<void> {
		await current.read()
	}

	return { workspace: current.data, load }
}
