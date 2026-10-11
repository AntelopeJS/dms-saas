<script setup lang="ts">
import { computed } from 'vue'

/** A legal document's published version, as the page loaded it. */
interface LegalDocumentRelease {
	version: number
	publishedAt: string | null
	path: string
}

const props = defineProps<{ modelValue?: LegalDocumentRelease | null }>()

const TEXT = 'saas.operator_billing.billing_rules.legal'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}

const { t, locale } = useI18n()

const isPublished = computed(() => !!props.modelValue?.publishedAt)

const summary = computed(() => {
	const release = props.modelValue
	if (!release?.publishedAt) return t(`${TEXT}.never_published`)
	return t(`${TEXT}.published`, {
		version: release.version,
		date: formatDate(release.publishedAt, locale.value, DAY_FORMAT),
	})
})

const nextVersion = computed(() => (props.modelValue?.version ?? 0) + 1)
</script>

<template>
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
		<DmsStatusPill
			:tone="isPublished ? 'success' : 'neutral'"
			:label="
				isPublished
					? $t(`${TEXT}.status_published`)
					: $t(`${TEXT}.status_draft`)
			"
		/>
		<span class="text-muted font-mono text-xs">{{ modelValue?.path }}</span>
		<span class="text-muted text-xs">{{ summary }}</span>
		<span class="text-dimmed text-xs">
			{{ $t(`${TEXT}.next_version`, { version: nextVersion }) }}
		</span>
		<UButton
			v-if="isPublished && modelValue?.path"
			:to="modelValue.path"
			target="_blank"
			variant="link"
			color="primary"
			size="xs"
			trailing-icon="i-ph-arrow-square-out"
			class="ms-auto"
		>
			{{ $t(`${TEXT}.view_public_page`) }}
		</UButton>
	</div>
</template>
