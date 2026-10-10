<script setup lang="ts">
import RequiredLegend from './RequiredLegend.vue'

/**
 * The rows of a hand-built form (`FormFieldRow`), hairlines between them,
 * and the legend of their required mark, as a DMS form ends its rows.
 */
interface FormRowsProps {
	/** Whether a row carries the required mark the legend explains. */
	hasRequired?: boolean
	/** Classes of the legend (its inset in a section). */
	legendClass?: string
}

const props = withDefaults(defineProps<FormRowsProps>(), {
	hasRequired: false,
	legendClass: undefined,
})
</script>

<template>
	<div class="flex flex-col">
		<slot />
		<RequiredLegend v-if="props.hasRequired" :class="props.legendClass" />
	</div>
</template>
