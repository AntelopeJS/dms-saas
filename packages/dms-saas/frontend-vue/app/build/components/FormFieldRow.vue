<script setup lang="ts">
/**
 * One field of a hand-built form, drawn as a DMS form draws its rows
 * (`FormEntries` / `FormFieldControl`): a `DmsFieldRow` holding the label,
 * its description and the required mark, and a label-less `UFormField`
 * holding the control, its help line and its error, which also marks the
 * control invalid.
 */
import { computed, useId } from 'vue'

interface FormFieldRowProps {
	label?: string
	/** Under the label. */
	description?: string
	/** Under the control, replaced by the error while there is one. */
	help?: string
	/** Already translated; marks the control invalid. */
	error?: string | null
	required?: boolean
	/** The card's side inset: rows of a `DmsSection`. */
	inset?: boolean
	/**
	 * Whether the label names the control the default slot binds the id to;
	 * off for a group of controls (cards, a Stripe element).
	 */
	labelsControl?: boolean
}

interface FormFieldRowControl {
	/** Id of the control, the one the label points to. */
	id: string
}

interface FormFieldRowSlots {
	/** The control; bind `id` onto it. */
	default?: (control: FormFieldRowControl) => unknown
	/** Replaces the help line (rich text, an icon). */
	help?: () => unknown
	/** Inline after the label (a badge). */
	'label-extra'?: () => unknown
	/** Under the help line, in the control column (a summary of the value). */
	after?: () => unknown
}

const props = withDefaults(defineProps<FormFieldRowProps>(), {
	label: undefined,
	description: undefined,
	help: undefined,
	error: null,
	required: false,
	inset: false,
	labelsControl: true,
})
const slots = defineSlots<FormFieldRowSlots>()

const controlId = useId()

// A form row without a label stacks: in the form layout its control would
// sit in the 240px label column.
const layout = computed(() => (props.label ? 'form' : 'stack'))
</script>

<template>
	<DmsFieldRow
		:layout="layout"
		:inset="props.inset"
		spacing="row"
		:label="props.label"
		:description="props.description"
		:label-for="props.labelsControl ? controlId : undefined"
		:required="props.required"
	>
		<template v-if="slots['label-extra']" #label-extra>
			<slot name="label-extra" />
		</template>
		<UFormField
			:help="props.help"
			:error="props.error ?? undefined"
			class="min-w-0"
		>
			<slot :id="controlId" />
			<template v-if="slots.help" #help>
				<slot name="help" />
			</template>
		</UFormField>
		<slot name="after" />
	</DmsFieldRow>
</template>
