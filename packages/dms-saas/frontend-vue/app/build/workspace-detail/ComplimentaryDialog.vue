<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FormFieldRow from '../components/FormFieldRow.vue'
import FormRows from '../components/FormRows.vue'
import { useApiErrorMessage } from '../../composables/useApiErrorMessage'
import { formatMinorUnits } from '../../composables/useMoneyFormat'
import { planPriceLabel } from './planPrice'
import type { ComplimentaryImpact } from './types'

/**
 * Grants (or updates) complimentary access. Over a paid Stripe subscription
 * it says which subscription is cancelled and the MRR it stops, and asks the
 * operator to acknowledge it — the server refuses it otherwise.
 */
const props = defineProps<{ tenantId: string }>()
const emit = defineEmits<{ done: []; cancel: [] }>()

const D = 'saas.workspace_detail.complimentary'
const MS_PER_DAY = 86_400_000

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()

const impact = ref<ComplimentaryImpact | null>(null)
const loadError = ref<string | null>(null)
const planId = ref<string | undefined>()
const freeUntil = ref('')
const isAcknowledged = ref(false)
const submitError = ref<string | null>(null)
const isSubmitting = ref(false)

const cancelsSubscription = computed(() => !!impact.value?.stripeSubscriptionId)
const selectedPlan = computed(() =>
	impact.value?.plans.find((plan) => plan.id === planId.value),
)
const planItems = computed(() =>
	(impact.value?.plans ?? []).map((plan) => ({
		value: plan.id,
		label: `${plan.name} · ${planPriceLabel(plan, t, locale.value)}`,
	})),
)
const daysLeft = computed(() => {
	if (!freeUntil.value) return null
	const ms = new Date(freeUntil.value).getTime() - Date.now()
	return Math.max(0, Math.ceil(ms / MS_PER_DAY))
})
const canSubmit = computed(
	() =>
		!!planId.value &&
		!isSubmitting.value &&
		(!cancelsSubscription.value || isAcknowledged.value),
)

function money(minor: number): string {
	return formatMinorUnits(minor, impact.value?.currency ?? null, locale.value)
}

const fitNote = computed(() => {
	const plan = selectedPlan.value
	const seats = impact.value?.seats ?? 0
	if (!plan) return ''
	if (plan.maxMembers < 0) return t(`${D}.fits_unlimited`, { seats })
	const key = plan.fits ? 'fits' : 'exceeds'
	return t(`${D}.${key}`, { seats, max: plan.maxMembers })
})

const cancellation = computed(() => {
	const current = impact.value
	if (!current?.stripeSubscriptionId) return ''
	const invoice = current.nextInvoice
	return t(`${D}.cancellation`, {
		id: current.stripeSubscriptionId,
		mrr: money(current.mrrMinor),
		date: invoice
			? formatDate(invoice.date, locale.value, { dateStyle: 'medium' })
			: '—',
	})
})

const submitLabel = computed(() => {
	if (cancelsSubscription.value) return t(`${D}.submit_cancel`)
	return impact.value?.isComplimentary
		? t(`${D}.submit_update`)
		: t(`${D}.submit`)
})

async function load(): Promise<void> {
	loadError.value = null
	try {
		impact.value = await $authFetch<ComplimentaryImpact>(
			`/api/saas/workspaces/${props.tenantId}/complimentary-impact`,
		)
		planId.value = impact.value.currentPlanId ?? impact.value.plans[0]?.id
		freeUntil.value = impact.value.freeUntil?.slice(0, 10) ?? ''
	} catch (error) {
		loadError.value = resolveApiError(error, `${D}.load_error`)
	}
}

async function submit(): Promise<void> {
	if (!canSubmit.value) return
	isSubmitting.value = true
	submitError.value = null
	try {
		await $authFetch(
			`/api/saas/workspaces/${props.tenantId}/grant-free-access`,
			{
				method: 'POST',
				body: {
					planId: planId.value,
					freeUntil: freeUntil.value || null,
					acknowledgeCancellation: isAcknowledged.value,
				},
			},
		)
		toast.add({
			title: t(`${D}.success`),
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
		<USkeleton v-else-if="!impact" class="h-32 w-full" />
		<template v-else>
			<p class="text-muted text-sm">
				{{ $t(`${D}.lead`, { name: impact.workspaceName }) }}
			</p>
			<FormRows has-required>
				<FormFieldRow :label="$t(`${D}.plan`)" :help="fitNote" required>
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
				<FormFieldRow
					:label="$t(`${D}.expires`)"
					:help="
						daysLeft === null
							? $t(`${D}.no_end`)
							: $t(`${D}.expires_help`, { count: daysLeft }, daysLeft)
					"
				>
					<template #default="{ id }">
						<DmsDatePicker
							:id="id"
							:model-value="freeUntil || undefined"
							@update:model-value="freeUntil = $event ?? ''"
						/>
					</template>
				</FormFieldRow>
			</FormRows>
			<DmsBanner
				v-if="cancelsSubscription"
				tone="error"
				icon="i-ph-warning"
				:title="$t(`${D}.cancellation_title`)"
				:description="cancellation"
			/>
			<DmsCheckbox
				v-if="cancelsSubscription"
				v-model="isAcknowledged"
				:label="$t(`${D}.acknowledge`)"
			/>
			<p v-if="impact.owner" class="text-muted flex items-center gap-2 text-sm">
				<UIcon name="i-ph-envelope-simple" class="size-4" />
				{{
					$t(`${D}.owner_emailed`, {
						owner: impact.owner.name || impact.owner.email,
					})
				}}
			</p>
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
				:color="cancelsSubscription ? 'error' : 'primary'"
				icon="i-ph-gift"
				:loading="isSubmitting"
				:disabled="!canSubmit"
				@click="submit"
			>
				{{ submitLabel }}
			</UButton>
		</div>
	</div>
</template>
