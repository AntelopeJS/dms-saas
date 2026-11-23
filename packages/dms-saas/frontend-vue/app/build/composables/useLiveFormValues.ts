import { onBeforeUnmount, onMounted, shallowRef } from 'vue'

/** A form value a panel can follow live: a switch, a number or a text. */
export type LiveFormScalar = boolean | number | string

/** The scalar values a form holds right now, by field name. */
export type LiveFormValues = ReadonlyMap<string, LiveFormScalar>

/** A value of a form field as a change reports it: scalars, lists, nested fields. */
export type LiveFormField =
	| LiveFormScalar
	| null
	| LiveFormField[]
	| LiveFormData

/** What a form holds, field by field, as a change reports it. */
export interface LiveFormData {
	readonly [field: string]: LiveFormField | undefined
}

interface FieldChangeDetail {
	component: string
	data: { formValues: LiveFormData }
}

function isObject(value: unknown): value is object {
	return typeof value === 'object' && value !== null
}

function isLiveFormField(value: unknown): value is LiveFormField {
	return (
		value === null ||
		isLiveFormScalar(value) ||
		(Array.isArray(value) && value.every(isLiveFormField)) ||
		isLiveFormData(value)
	)
}

function isLiveFormData(value: unknown): value is LiveFormData {
	return (
		isObject(value) &&
		!Array.isArray(value) &&
		Object.values(value).every(
			(field) => field === undefined || isLiveFormField(field),
		)
	)
}

function isFieldChangeDetail(value: unknown): value is FieldChangeDetail {
	return (
		isObject(value) &&
		'component' in value &&
		typeof value.component === 'string' &&
		'data' in value &&
		isObject(value.data) &&
		'formValues' in value.data &&
		isLiveFormData(value.data.formValues)
	)
}

function isLiveFormScalar(value: unknown): value is LiveFormScalar {
	return (
		typeof value === 'boolean' ||
		typeof value === 'number' ||
		typeof value === 'string'
	)
}

/** Whether a live form value is a switch. */
export function isLiveBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean'
}

/** Whether a live form value is a number. */
export function isLiveNumber(value: unknown): value is number {
	return typeof value === 'number'
}

function scalarsOf(formValues: LiveFormData): LiveFormValues {
	const scalars = new Map<string, LiveFormScalar>()
	for (const [field, value] of Object.entries(formValues)) {
		if (isLiveFormScalar(value)) scalars.set(field, value)
	}
	return scalars
}

/**
 * What a form holds right now, read through `parse` (the DMS form broadcasts
 * each change of its values as `FormEvents.FIELD_CHANGE`), unsaved changes
 * included, for a panel drawn among its fields: `null` until the form reports
 * a change `parse` accepts.
 *
 * @param componentId Id of the form, as its fields receive it
 * @param parse Reads the form's values as a change reports them; `null`
 *   rejects the change and keeps the previous snapshot
 */
export function useLiveFormSnapshot<T>(
	componentId: () => string | undefined,
	parse: (formValues: LiveFormData) => T | null,
) {
	const values = shallowRef<T | null>(null)

	function onFieldChange(event: Event): void {
		if (!(event instanceof CustomEvent)) return
		const detail: unknown = event.detail
		const formId = componentId()
		if (!formId || !isFieldChangeDetail(detail) || detail.component !== formId)
			return
		const snapshot = parse(detail.data.formValues)
		if (snapshot !== null) values.value = snapshot
	}

	onMounted(() =>
		window.addEventListener(FormEvents.FIELD_CHANGE, onFieldChange),
	)
	onBeforeUnmount(() =>
		window.removeEventListener(FormEvents.FIELD_CHANGE, onFieldChange),
	)

	return values
}

/**
 * The scalar values a form holds right now, unsaved changes included:
 * `null` until the form reports a change.
 *
 * @param componentId Id of the form, as its fields receive it
 */
export function useLiveFormValues(componentId: () => string | undefined) {
	return useLiveFormSnapshot(componentId, scalarsOf)
}

/**
 * A value of the form: the live one once the form reported a change, else
 * the one the panel loaded with.
 *
 * @param live Values the form reports, `null` before its first change
 * @param key Field name
 * @param loaded The value the panel loaded with
 * @param isValue Tells whether a live value is of the kind the panel reads
 */
export function liveValue<T extends LiveFormScalar>(
	live: LiveFormValues | null,
	key: string,
	loaded: T,
	isValue: (value: unknown) => value is T,
): T {
	const value = live?.get(key)
	return isValue(value) ? value : loaded
}
