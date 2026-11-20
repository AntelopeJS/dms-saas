<script setup lang="ts">
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'

/** A workspace's tile: its logo, or its initial when it has none or it fails to load. */
const props = defineProps<{
	name: string
	logoUrl: string | null
}>()

const hasFailed = ref(false)
const logo = useTemplateRef<HTMLImageElement>('logo')

/** A server-rendered image can fail before hydration, so its error event is already gone. */
function checkLoaded(): void {
	const image = logo.value
	if (image?.complete && image.naturalWidth === 0) hasFailed.value = true
}

onMounted(checkLoaded)
watch(
	() => props.logoUrl,
	async () => {
		hasFailed.value = false
		await nextTick()
		checkLoaded()
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
			ref="logo"
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
