import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hasSegmentConditions } from './tree'
import type { SegmentPreview } from './types'
import { useSegmentDraft } from './useSegmentDraft'

const PREVIEW_URL = '/api/saas/segments/preview'
const RECOUNT_DELAY_MS = 500
/** Sent by a DMS form once it saved (`FormEvents.SUBMIT_SUCCESS`). */
const FORM_SAVED_EVENT = 'DmsComponent.Form.SubmitSuccess'

/**
 * Recounts the rules being edited, without saving them: on each edit, once
 * typing pauses, and after the form saved (the saved version changed).
 */
export function useSegmentPreview(segmentId: () => string | undefined) {
	const { $authFetch } = useAuthFetch()
	const draft = useSegmentDraft()
	const hasFailed = ref(false)
	const recountedAt = ref<Date | null>(null)
	let timer: ReturnType<typeof setTimeout> | null = null
	let latestRequest = 0

	const hasRules = computed(
		() =>
			!!draft.conditions.value && hasSegmentConditions(draft.conditions.value),
	)

	async function recount(): Promise<void> {
		const conditions = draft.conditions.value
		if (!conditions || !hasSegmentConditions(conditions)) {
			draft.preview.value = null
			draft.isRecounting.value = false
			return
		}
		const request = ++latestRequest
		draft.isRecounting.value = true
		try {
			const preview = await $authFetch<SegmentPreview>(PREVIEW_URL, {
				method: 'POST',
				body: { conditions, segmentId: segmentId() },
			})
			if (request !== latestRequest) return
			draft.preview.value = preview
			recountedAt.value = new Date()
			hasFailed.value = false
		} catch {
			if (request === latestRequest) hasFailed.value = true
		} finally {
			if (request === latestRequest) draft.isRecounting.value = false
		}
	}

	function scheduleRecount(): void {
		if (timer) clearTimeout(timer)
		draft.isRecounting.value = hasRules.value
		timer = setTimeout(() => void recount(), RECOUNT_DELAY_MS)
	}

	const onSaved = () => void recount()

	watch(() => JSON.stringify(draft.conditions.value), scheduleRecount)
	onMounted(() => {
		window.addEventListener(FORM_SAVED_EVENT, onSaved)
		scheduleRecount()
	})
	onBeforeUnmount(() => {
		if (timer) clearTimeout(timer)
		window.removeEventListener(FORM_SAVED_EVENT, onSaved)
	})

	return {
		preview: draft.preview,
		isRecounting: draft.isRecounting,
		conditions: draft.conditions,
		hasRules,
		hasFailed,
		recountedAt,
		recount,
	}
}
