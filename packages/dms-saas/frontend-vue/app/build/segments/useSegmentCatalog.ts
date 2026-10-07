import { computed, type ComputedRef, type Ref } from 'vue'
import type {
	SegmentFieldDefinition,
	SegmentFieldsCatalog,
	SegmentScope,
} from './types'

export const SEGMENT_FIELDS_URL = '/api/saas/segments/fields'
const CATALOG_STATE_KEY = 'saas-segment-fields'

const EMPTY_CATALOG: SegmentFieldsCatalog = {
	fields: [],
	userFields: [],
	plans: [],
}

export interface SegmentCatalog {
	catalog: ComputedRef<SegmentFieldsCatalog>
	isLoading: ComputedRef<boolean>
	error: Ref<boolean>
	load: () => Promise<unknown>
	refresh: () => Promise<unknown>
	fieldsOf: (scope: SegmentScope) => SegmentFieldDefinition[]
	findField: (
		scope: SegmentScope,
		fieldId: string,
	) => SegmentFieldDefinition | undefined
}

/**
 * The fields a rule can read, fetched once per page whatever the number of
 * builders, rule cells and previews reading it.
 */
export function useSegmentCatalog(
	url: string = SEGMENT_FIELDS_URL,
): SegmentCatalog {
	const { $authFetch } = useAuthFetch()
	const request = useSharedRequest<SegmentFieldsCatalog>(
		`${CATALOG_STATE_KEY}:${url}`,
		() => $authFetch<SegmentFieldsCatalog>(url),
	)
	const catalog = computed(() => request.data.value ?? EMPTY_CATALOG)

	function fieldsOf(scope: SegmentScope): SegmentFieldDefinition[] {
		return scope === 'user' ? catalog.value.userFields : catalog.value.fields
	}

	return {
		catalog,
		isLoading: computed(() => !request.data.value && !request.error.value),
		error: request.error,
		load: request.load,
		refresh: request.refresh,
		fieldsOf,
		findField: (scope, fieldId) =>
			fieldsOf(scope).find((field) => field.id === fieldId),
	}
}
