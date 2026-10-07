<script setup lang="ts">
/**
 * The elevated card every public screen sits in on the empty layout's
 * stage, built from the DMS's public card, icon well and eyebrow.
 */
type PublicStageWidth = 'default' | 'wide' | 'xwide'
type PublicStageTone = 'primary' | 'success' | 'warning' | 'error' | 'neutral'

interface PublicStageProps {
	width?: PublicStageWidth
	title?: string
	description?: string
	eyebrow?: string
	icon?: string
	tone?: PublicStageTone
}

const props = withDefaults(defineProps<PublicStageProps>(), {
	width: 'default',
	title: undefined,
	description: undefined,
	eyebrow: undefined,
	icon: undefined,
	tone: 'primary',
})

const WIDTH_CLASSES: Record<PublicStageWidth, string> = {
	default: 'max-w-[440px]',
	wide: 'max-w-[560px]',
	xwide: 'max-w-[720px]',
}
</script>

<template>
	<DmsCard
		as="section"
		variant="elevated"
		:padded="false"
		class="mx-auto w-full rounded-[16px] px-5 py-6 sm:p-8"
		:class="WIDTH_CLASSES[props.width]"
	>
		<DmsIconWell v-if="props.icon" :tone="props.tone" size="xl" class="mb-4">
			<UIcon :name="props.icon" class="size-5" />
		</DmsIconWell>

		<slot name="eyebrow">
			<DmsEyebrow
				v-if="props.eyebrow"
				as="span"
				tone="primary"
				class="mb-2.5 block"
				:label="props.eyebrow"
			/>
		</slot>

		<h1
			v-if="props.title"
			class="text-highlighted text-xl font-[650] leading-tight tracking-[-0.025em]"
		>
			{{ props.title }}
		</h1>

		<p
			v-if="props.description || $slots.description"
			class="text-muted mt-1.5 text-[13px]"
		>
			<slot name="description">{{ props.description }}</slot>
		</p>

		<slot />
	</DmsCard>
</template>
