<script setup lang="ts">
defineProps<{ value: unknown }>()
</script>

<template>
	<span
		v-if="typeof value === 'string' && value"
		class="flex min-w-0 items-center gap-2"
	>
		<UAvatar :alt="value" size="2xs" />
		<span class="truncate text-sm">{{ value }}</span>
	</span>
	<span v-else class="text-muted flex items-center gap-1.5 text-sm">
		<UIcon name="i-ph-robot" class="size-4" />
		{{ $t('saas.operator_billing.credit_notes.automatic') }}
	</span>
</template>
