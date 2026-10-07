import { onBeforeUnmount, onMounted, ref } from 'vue'

// The DMS form broadcasts every change of its values under this event name
// (`FormEvents.FIELD_CHANGE`), with the whole state as `formValues`.
const FIELD_CHANGE_EVENT = 'DmsComponent.Form.FieldChange'

interface FieldChangePayload {
	formValues?: Record<string, unknown>
}

interface FieldChangeDetail {
	component?: string
	data?: FieldChangePayload
}

/**
 * The values a form holds right now, unsaved changes included, for a panel
 * drawn among its fields: `null` until the form reports a change.
 *
 * @param componentId Id of the form, as its fields receive it
 */
export function useLiveFormValues(componentId: () => string | undefined) {
	const values = ref<Record<string, unknown> | null>(null)

	function onFieldChange(event: Event): void {
		const detail = (event as CustomEvent<FieldChangeDetail>).detail
		const formId = componentId()
		if (!formId || detail?.component !== formId) return
		const formValues = detail.data?.formValues
		if (formValues) values.value = { ...formValues }
	}

	onMounted(() => window.addEventListener(FIELD_CHANGE_EVENT, onFieldChange))
	onBeforeUnmount(() =>
		window.removeEventListener(FIELD_CHANGE_EVENT, onFieldChange),
	)

	return values
}

/**
 * A value of the form: the live one once the form reported a change, else
 * the one the panel loaded with.
 */
export function liveValue<T>(
	live: Record<string, unknown> | null,
	key: string,
	loaded: T,
): T {
	const value = live?.[key]
	return value === undefined || value === null ? loaded : (value as T)
}
