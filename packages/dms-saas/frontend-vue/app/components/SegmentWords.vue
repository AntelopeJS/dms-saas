<script setup lang="ts">
import type { SegmentWordToken } from '../build/segments/types'

defineProps<{ tokens: SegmentWordToken[] }>()

const TIGHT_BEFORE = new Set([',', '.', ')'])
const TIGHT_AFTER = new Set(['('])

function spaced(tokens: SegmentWordToken[], index: number): boolean {
	if (index === 0) return false
	const current = tokens[index]!.text
	const previous = tokens[index - 1]!.text
	return !TIGHT_BEFORE.has(current) && !TIGHT_AFTER.has(previous)
}
</script>

<template>
	<span>
		<template v-for="(token, index) in tokens" :key="index">
			<template v-if="spaced(tokens, index)">{{ ' ' }}</template>
			<DmsStatusPill
				v-if="token.tone"
				:tone="token.tone"
				:label="token.text"
				dot="none"
				size="sm"
				:mono="false"
				class="align-middle"
			/>
			<b v-else-if="token.isStrong" class="text-highlighted font-semibold">
				{{ token.text }}
			</b>
			<template v-else>{{ token.text }}</template>
		</template>
	</span>
</template>
