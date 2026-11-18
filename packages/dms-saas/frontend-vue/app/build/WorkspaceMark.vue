<script setup lang="ts">
import { ref, watch } from 'vue'

/** A workspace's tile: its logo, or its initial when it has none or it fails to load. */
const props = defineProps<{
	name: string
	logoUrl: string | null
}>()

const hasFailed = ref(false)
watch(
	() => props.logoUrl,
	() => {
		hasFailed.value = false
	},
)

function initialOf(name: string): string {
	return (name.trim()[0] ?? '?').toUpperCase()
}
</script>

<template>
	<span
		v-if="logoUrl && !hasFailed"
		class="ring-default inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1"
	>
		<img
			:src="logoUrl"
			alt=""
			class="size-full object-contain"
			@error="hasFailed = true"
		/>
	</span>
	<span
		v-else
		class="from-primary-500 to-primary-600 bg-linear-to-br inline-flex shrink-0 items-center justify-center font-bold text-white"
	>
		{{ initialOf(name) }}
	</span>
</template>
