import type { Ref } from 'vue'
import type { SegmentConditionGroup, SegmentPreview } from './types'

const DRAFT_STATE_KEY = 'saas-segment-draft'

/**
 * The rules being edited and their preview, shared by the editor's builder
 * (which writes the rules and reads the counts) and the live preview (which
 * reads the rules and writes the counts): two blocks of one page.
 */
export interface SegmentDraft {
	conditions: Ref<SegmentConditionGroup | null>
	preview: Ref<SegmentPreview | null>
	/** A recount for the latest edit is on its way. */
	isRecounting: Ref<boolean>
}

export function useSegmentDraft(): SegmentDraft {
	return {
		conditions: useDmsState<SegmentConditionGroup | null>(
			`${DRAFT_STATE_KEY}:conditions`,
			() => null,
		),
		preview: useDmsState<SegmentPreview | null>(
			`${DRAFT_STATE_KEY}:preview`,
			() => null,
		),
		isRecounting: useDmsState<boolean>(
			`${DRAFT_STATE_KEY}:recounting`,
			() => false,
		),
	}
}
