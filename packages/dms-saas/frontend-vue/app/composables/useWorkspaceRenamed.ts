import { onBeforeUnmount, onMounted } from 'vue'

/** The General page's rename form, which changes the workspace's name. */
const RENAME_SUBMIT_URL = '/api/saas/workspaces/current'

interface FormSubmitPayload {
	submitUrl?: string
}

interface FormSubmitDetail {
	data?: FormSubmitPayload
}

/** Whether a form's success event is the rename of the current workspace. */
function isWorkspaceRenameEvent(event: Event): boolean {
	const detail = (event as CustomEvent<FormSubmitDetail>).detail
	return detail?.data?.submitUrl === RENAME_SUBMIT_URL
}

/**
 * Runs `onRenamed` each time the General page's form renames the current
 * workspace, for as long as the calling component is mounted: whatever shows
 * the name (the switcher, the deletion's typed confirmation) reads it again.
 */
export function useWorkspaceRenamed(onRenamed: () => void): void {
	function onFormSaved(event: Event): void {
		if (isWorkspaceRenameEvent(event)) onRenamed()
	}
	onMounted(() => window.addEventListener(FormEvents.SUBMIT_SUCCESS, onFormSaved))
	onBeforeUnmount(() =>
		window.removeEventListener(FormEvents.SUBMIT_SUCCESS, onFormSaved),
	)
}
