<script setup lang="ts">
import type { SegmentLogical } from '../build/segments/types'

defineProps<{ modelValue: SegmentLogical; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: SegmentLogical] }>()

const CHOICES: readonly SegmentLogical[] = ['and', 'or']
</script>

<template>
	<UFieldGroup size="xs">
		<UButton
			v-for="choice in CHOICES"
			:key="choice"
			:label="$t(`saas.segments.builder.logical.${choice}`)"
			:color="modelValue === choice ? 'primary' : 'neutral'"
			:variant="modelValue === choice ? 'soft' : 'outline'"
			:aria-pressed="modelValue === choice"
			:disabled="disabled"
			class="font-mono text-[11px] font-semibold"
			@click="emit('update:modelValue', choice)"
		/>
	</UFieldGroup>
</template>
