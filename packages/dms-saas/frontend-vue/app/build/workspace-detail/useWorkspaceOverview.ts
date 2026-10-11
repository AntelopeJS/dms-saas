import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { WorkspaceOverview } from './types'

/** The workspace an operator looks at, refreshed after each action on it. */
export interface WorkspaceOverviewState {
	overview: Ref<WorkspaceOverview | null>
	isLoading: Ref<boolean>
	hasError: Ref<boolean>
	load: () => Promise<void>
}

/**
 * Reads the header of a workspace's detail page, again each time the page
 * refreshes its blocks after an operator action.
 */
export function useWorkspaceOverview(tenantId: string): WorkspaceOverviewState {
	const { $authFetch } = useAuthFetch()
	const overview = ref<WorkspaceOverview | null>(null)
	const isLoading = ref(true)
	const hasError = ref(false)

	async function load(): Promise<void> {
		if (!tenantId) return
		isLoading.value = true
		try {
			overview.value = await $authFetch<WorkspaceOverview>(
				`/api/saas/workspaces/${tenantId}/overview`,
			)
			hasError.value = false
		} catch {
			hasError.value = true
		} finally {
			isLoading.value = false
		}
	}

	let stopRefresh: (() => void) | undefined
	onMounted(() => {
		void load()
		stopRefresh = onPageBlocksRefresh(() => void load())
	})
	onBeforeUnmount(() => stopRefresh?.())
	return { overview, isLoading, hasError, load }
}
