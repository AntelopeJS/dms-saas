<script setup lang="ts">
/** How a workspace came to be blocked, oldest first, deadlines included. */
import {
	type AccessTimelineEntry,
	daysUntil,
	TIMELINE_STEP_VIEWS,
	type UnpaidInvoiceRef,
} from './access'

interface AccessTimelineProps {
	entries: AccessTimelineEntry[]
	invoice: UnpaidInvoiceRef | null
}

const props = defineProps<AccessTimelineProps>()

const { t, locale } = useI18n()
const { formatMinorUnits } = useMoneyFormat()

function formatDate(value: string): string {
	return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
		new Date(value),
	)
}

function stepTitle(entry: AccessTimelineEntry): string {
	return t(`saas.public.suspended.timeline.${entry.kind}`, {
		invoice: props.invoice?.number ?? '',
		amount: props.invoice
			? formatMinorUnits(props.invoice.amount, props.invoice.currency)
			: '',
	})
}

function stepNote(entry: AccessTimelineEntry): string | null {
	if (!entry.isUpcoming) return null
	const days = daysUntil(entry.at)
	return t(
		'saas.public.suspended.timeline.days_left',
		{ days: String(days) },
		days,
	)
}
</script>

<template>
	<ol class="flex flex-col gap-3">
		<li
			v-for="entry in entries"
			:key="entry.kind"
			class="flex items-start gap-3"
		>
			<DmsIconWell
				:icon="TIMELINE_STEP_VIEWS[entry.kind].icon"
				:tone="
					entry.isUpcoming ? 'muted' : TIMELINE_STEP_VIEWS[entry.kind].tone
				"
				size="sm"
			/>
			<div class="min-w-0 text-[13px]">
				<p class="text-muted font-mono text-xs">{{ formatDate(entry.at) }}</p>
				<p class="text-highlighted font-medium">{{ stepTitle(entry) }}</p>
				<p v-if="stepNote(entry)" class="text-warning text-xs">
					{{ stepNote(entry) }}
				</p>
			</div>
		</li>
	</ol>
</template>
