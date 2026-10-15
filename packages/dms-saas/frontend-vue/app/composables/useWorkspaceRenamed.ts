import { onBeforeUnmount, onMounted } from 'vue'

/** The General page's rename form, which changes the workspace's name. */
const RENAME_SUBMIT_URL = '/api/saas/workspaces/current'

/** What the rename answers: the workspace, and its name as stored (trimmed). */
export interface RenamedWorkspace {
	_id: string
	name: string
}

interface FormSubmitPayload {
	submitUrl?: string
	response?: unknown
}

interface FormSubmitDetail {
	data?: FormSubmitPayload
}

/** The renamed workspace a form's success event carries, if it is the rename. */
function renamedWorkspaceOf(event: Event): RenamedWorkspace | null {
	const payload = (event as CustomEvent<FormSubmitDetail>).detail?.data
	return payload?.submitUrl === RENAME_SUBMIT_URL
		? (payload.response as RenamedWorkspace)
		: null
}

/**
 * Runs `onRenamed` with the rename's answer each time the General page's form
 * renames the current workspace, for as long as the calling component is
 * mounted: whatever shows the name (the switcher, the deletion's typed
 * confirmation) puts the new one in place, without reading it again.
 */
export function useWorkspaceRenamed(
	onRenamed: (workspace: RenamedWorkspace) => void,
): void {
	function onFormSaved(event: Event): void {
		const renamed = renamedWorkspaceOf(event)
		if (renamed) onRenamed(renamed)
	}
	onMounted(() => window.addEventListener(FormEvents.SUBMIT_SUCCESS, onFormSaved))
	onBeforeUnmount(() =>
		window.removeEventListener(FormEvents.SUBMIT_SUCCESS, onFormSaved),
	)
}
