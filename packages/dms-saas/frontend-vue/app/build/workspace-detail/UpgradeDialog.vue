<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import FormFieldRow from '../components/FormFieldRow.vue'
import FormRows from '../components/FormRows.vue'
import { useApiErrorMessage } from '../../composables/useApiErrorMessage'
import { formatMinorUnits } from '../../composables/useMoneyFormat'
import type { OperatorOptions, UpgradePreview } from './types'

/**
 * Moves a paying workspace to a higher plan now. The figures are Stripe's own
 * preview — prorated lines, tax, what is due and when, the next renewal and
 * the MRR change — and the button names the amount.
 */
const props = defineProps<{ tenantId: string }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const D = 'saas.workspace_detail.upgrade'

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()

const options = ref<OperatorOptions | null>(null)
const loadError = ref<string | null>(null)
const planId = ref<string | undefined>()
const preview = ref<UpgradePreview | null>(null)
const previewError = ref<string | null>(null)
const isPreviewing = ref(false)
const submitError = ref<string | null>(null)
const isSubmitting = ref(false)
const operationId = crypto.randomUUID()

const plans = computed(() => options.value?.eligibleUpgradePlans ?? [])
const planItems = computed(() =>
	plans.value.map((plan) => ({ value: plan.id, label: plan.name })),
)

function money(minor: number): string {
	return formatMinorUnits(minor, preview.value?.currency ?? null, locale.value)
}

function day(value: string): string {
	return formatDate(value, locale.value, { dateStyle: 'medium' }) ?? value
}

const taxLabel = computed(() => {
	const figures = preview.value
	if (!figures) return ''
	if (figures.isReverseCharge) return t(`${D}.tax_reverse_charge`)
	return figures.taxRatePercent === null
		? t(`${D}.tax`)
		: t(`${D}.tax_rate`, {
				rate: figures.taxRatePercent,
				country: figures.taxCountry ?? '',
			})
})

const submitLabel = computed(() => {
	const figures = preview.value
	if (!figures) return t(`${D}.submit`)
	return figures.isChargedNow
		? t(`${D}.submit_now`, { amount: money(figures.amountDueMinor) })
		: t(`${D}.submit_next_invoice`, { date: day(figures.billingDate) })
})

async function load(): Promise<void> {
	loadError.value = null
	try {
		options.value = await $authFetch<OperatorOptions>(
			`/api/saas/workspaces/${props.tenantId}/operator-options`,
		)
		planId.value = plans.value[0]?.id
	} catch (error) {
		loadError.value = resolveApiError(error, `${D}.load_error`)
	}
}

async function loadPreview(): Promise<void> {
	if (!planId.value) return
	isPreviewing.value = true
	previewError.value = null
	preview.value = null
	try {
		preview.value = await $authFetch<UpgradePreview>(
			`/api/saas/workspaces/${props.tenantId}/upgrade-preview`,
			{ query: { planId: planId.value } },
		)
	} catch (error) {
		previewError.value = resolveApiError(error, `${D}.preview_error`)
	} finally {
		isPreviewing.value = false
	}
}

async function submit(): Promise<void> {
	if (!preview.value || isSubmitting.value) return
	isSubmitting.value = true
	submitError.value = null
	try {
		await $authFetch(`/api/saas/workspaces/${props.tenantId}/upgrade`, {
			method: 'POST',
			body: { operationId, planId: planId.value },
		})
		toast.add({
			title: t(`${D}.success`, { plan: preview.value.target.name }),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
		emit('done')
	} catch (error) {
		submitError.value = resolveApiError(error, `${D}.error`)
	} finally {
		isSubmitting.value = false
	}
}

watch(planId, loadPreview)
onMounted(load)
</script>

<template>
	<div class="flex flex-col gap-4">
		<DmsEmptyState
			v-if="loadError"
			variant="error"
			size="sm"
			:title="$t(`${D}.load_error`)"
			:description="loadError"
			:actions="[{ label: $t('saas.workspace_detail.retry'), onClick: load }]"
		/>
		<USkeleton v-else-if="!options" class="h-24 w-full" />
		<DmsEmptyState
			v-else-if="plans.length === 0"
			variant="no-result"
			size="sm"
			:title="$t(`${D}.unavailable_title`)"
			:description="
				options.hasStripeSubscription
					? $t(`${D}.unavailable_no_plan`)
					: $t(`${D}.unavailable_no_subscription`)
			"
		/>
		<template v-else>
			<FormRows has-required>
				<FormFieldRow :label="$t(`${D}.target`)" required>
					<template #default="{ id }">
						<DmsSelect
							:id="id"
							v-model="planId"
							:items="planItems"
							:deselectable="false"
							class="w-full"
						/>
					</template>
				</FormFieldRow>
			</FormRows>
			<USkeleton v-if="isPreviewing" class="h-40 w-full" />
			<DmsEmptyState
				v-else-if="previewError"
				variant="error"
				size="sm"
				:title="$t(`${D}.preview_error`)"
				:description="previewError"
				:actions="[
					{ label: $t('saas.workspace_detail.retry'), onClick: loadPreview },
				]"
			/>
			<template v-else-if="preview">
				<DmsKeyValueList
					dense
					:currency="preview.currency"
					:items="[
						{
							label: $t(`${D}.current`),
							value: `${preview.current.name} · ${money(preview.current.unitAmountMinor)} / ${$t(`saas.workspaces.interval.${preview.current.interval}`)}`,
						},
						{
							label: $t(`${D}.new`),
							value: `${preview.target.name} · ${money(preview.target.unitAmountMinor)} / ${$t(`saas.workspaces.interval.${preview.target.interval}`)}`,
						},
					]"
				/>
				<div
					class="border-default divide-default divide-y rounded-md border text-sm"
				>
					<div
						v-for="(line, index) in preview.lines"
						:key="index"
						class="flex justify-between gap-4 px-3 py-2"
					>
						<span class="text-muted">{{ line.description ?? '—' }}</span>
						<span class="font-mono tabular-nums">
							{{ money(line.amountMinor) }}
						</span>
					</div>
					<div class="flex justify-between gap-4 px-3 py-2">
						<span>{{ $t(`${D}.subtotal`) }}</span>
						<span class="font-mono tabular-nums">
							{{ money(preview.subtotalMinor) }}
						</span>
					</div>
					<div class="flex justify-between gap-4 px-3 py-2">
						<span>{{ taxLabel }}</span>
						<span class="font-mono tabular-nums">
							{{ money(preview.taxMinor) }}
						</span>
					</div>
					<div class="flex justify-between gap-4 px-3 py-2 font-semibold">
						<span>
							{{
								preview.isChargedNow
									? $t(`${D}.due_today`)
									: $t(`${D}.due_on`, { date: day(preview.billingDate) })
							}}
						</span>
						<span class="font-mono tabular-nums">
							{{ money(preview.amountDueMinor) }}
						</span>
					</div>
				</div>
				<p class="text-muted text-sm">
					{{
						$t(`${D}.then`, {
							amount: money(preview.renewalAmountMinor),
							interval: $t(
								`saas.workspaces.interval.${preview.target.interval}`,
							),
							before: money(preview.mrrBeforeMinor),
							after: money(preview.mrrAfterMinor),
						})
					}}
				</p>
			</template>
			<UAlert
				v-if="submitError"
				color="error"
				variant="subtle"
				icon="i-ph-warning-circle"
				:description="submitError"
			/>
		</template>
		<div class="flex justify-end gap-2">
			<UButton color="neutral" variant="ghost" @click="emit('cancel')">
				{{ $t('common.cancel') }}
			</UButton>
			<UButton
				color="primary"
				icon="i-ph-arrow-circle-up"
				:loading="isSubmitting"
				:disabled="!preview || isPreviewing"
				@click="submit"
			>
				{{ submitLabel }}
			</UButton>
		</div>
	</div>
</template>
