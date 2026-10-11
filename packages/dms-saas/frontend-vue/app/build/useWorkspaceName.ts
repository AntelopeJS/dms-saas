import { computed, type ComputedRef } from 'vue'

/**
 * The current workspace's name, read from the caller's own workspace list
 * (which the sidebar switcher already loads), so it is known to members too.
 * Empty until the list is loaded.
 */
export function useWorkspaceName(): ComputedRef<string> {
	const { workspaces, isLoaded, refresh } = useMyWorkspaces()
	if (!isLoaded.value) void refresh().catch(() => undefined)
	return computed(
		() => workspaces.value.find((workspace) => workspace.isCurrent)?.name ?? '',
	)
}
