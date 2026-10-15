import { computed, type ComputedRef, type Ref } from 'vue'
import type { WorkspaceOverview } from './types'

/** The workspace an operator looks at, refreshed after each action on it. */
export interface WorkspaceOverviewState {
	overview: Ref<WorkspaceOverview | null>
	isLoading: ComputedRef<boolean>
	hasError: ComputedRef<boolean>
	load: () => Promise<void>
}

/**
 * Reads the header of a workspace's detail page, again each time the page
 * refreshes its blocks after an operator action (as every `useApiData` read
 * of the page does). The header, the operator card and the suspend button
 * share one read.
 */
export function useWorkspaceOverview(tenantId: string): WorkspaceOverviewState {
	const { data, status, refresh } = useApiData<WorkspaceOverview>(
		tenantId ? `/api/saas/workspaces/${tenantId}/overview` : null,
	)
	return {
		overview: data,
		isLoading: computed(
			() => status.value === 'pending' || status.value === 'idle',
		),
		hasError: computed(() => status.value === 'error'),
		load: () => refresh(),
	}
}
