<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	liveValue,
	useLiveFormValues,
} from '../build/composables/useLiveFormValues'

/** How far the plans' Stripe products carry the tax category. */
interface PlanTaxSyncStatus {
	taxCode: string
	synced: number
	total: number
	syncedAt: string | null
	isStripeConfigured: boolean
}

const props = defineProps<{
	modelValue?: PlanTaxSyncStatus | null
	componentId?: string
}>()

const TEXT = 'saas.operator_billing.billing_rules.tax'
const RESYNC_ENDPOINT = '/api/saas/settings/billing/resync-plans'
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
}

const { t, locale } = useI18n()
const toast = useToast()
const { $authFetch } = useAuthFetch()
const { resolveApiError } = useApiErrorMessage()
const live = useLiveFormValues(() => props.componentId)

const status = ref<PlanTaxSyncStatus | null>(props.modelValue ?? null)
const isSyncing = ref(false)

watch(
	() => props.modelValue,
	(next) => {
		status.value = next ?? null
	},
)

const isTaxCodeUnsaved = computed(() => {
	const saved = status.value?.taxCode
	return !!saved && liveValue(live.value, 'stripeTaxCode', saved) !== saved
})

const summary = computed(() => {
	const current = status.value
	if (!current) return ''
	if (!current.isStripeConfigured) return t(`${TEXT}.plans_not_configured`)
	const counts = { synced: current.synced, total: current.total }
	if (!current.syncedAt) return t(`${TEXT}.plans_summary`, counts)
	return t(`${TEXT}.plans_summary_synced`, {
		...counts,
		date: formatDate(current.syncedAt, locale.value, DATE_TIME_FORMAT),
	})
})

const isInLine = computed(
	() => !!status.value && status.value.synced === status.value.total,
)

async function resync(): Promise<void> {
	isSyncing.value = true
	try {
		status.value = await $authFetch<PlanTaxSyncStatus>(RESYNC_ENDPOINT, {
			method: 'POST',
		})
		toast.add({
			title: t(`${TEXT}.resync_done`),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (error) {
		toast.add({
			title: resolveApiError(error, `${TEXT}.resync_failed`),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	} finally {
		isSyncing.value = false
	}
}
</script>

<template>
	<div
		class="border-default flex flex-wrap items-center gap-3 rounded-lg border p-3"
	>
		<DmsIconWell
			:icon="isInLine ? 'i-ph-check-circle' : 'i-ph-arrows-clockwise'"
			:tone="isInLine ? 'success' : 'warning'"
			size="sm"
		/>
		<div class="min-w-0 grow">
			<p class="text-highlighted text-sm">{{ summary }}</p>
			<p v-if="isTaxCodeUnsaved" class="text-warning text-xs">
				{{ $t(`${TEXT}.unsaved_code`) }}
			</p>
		</div>
		<UButton
			color="neutral"
			variant="outline"
			size="sm"
			icon="i-ph-arrows-clockwise"
			:loading="isSyncing"
			:disabled="!status?.isStripeConfigured || isTaxCodeUnsaved"
			@click="resync"
		>
			{{ $t(`${TEXT}.resync`) }}
		</UButton>
	</div>
</template>
