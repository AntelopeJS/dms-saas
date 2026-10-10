<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FormFieldRow from '../components/FormFieldRow.vue'
import FormRows from '../components/FormRows.vue'
import { useApiErrorMessage } from '../../composables/useApiErrorMessage'
import {
	formatMinorUnits,
	fromMinorUnits,
	toMinorUnits,
} from '../../composables/useMoneyFormat'
import type { OperatorOptions } from './types'

/**
 * Grants credit on the Stripe customer balance, typed in major units: the
 * ceiling and its reason, the balance before and after, and what the next
 * invoice drops to, before anything is sent. The server holds the same
 * ceiling.
 */
const props = defineProps<{
	tenantId: string
	workspaceName: string
}>()

const emit = defineEmits<{ done: []; cancel: [] }>()

const D = 'saas.workspace_detail.credit'
const REASON_MAX_LENGTH = 500

const { $authFetch } = useAuthFetch()
const { t, locale } = useI18n()
const toast = useToast()
const { resolveApiError } = useApiErrorMessage()

const options = ref<OperatorOptions | null>(null)
const loadError = ref<string | null>(null)
const submitError = ref<string | null>(null)
const amount = ref<number | undefined>()
const reason = ref('')
const isSubmitting = ref(false)
const operationId = crypto.randomUUID()

const currency = computed(() => options.value?.currency ?? 'EUR')
const amountMinor = computed(() =>
	amount.value ? toMinorUnits(amount.value, currency.value) : 0,
)
const balanceMinor = computed(() =>
	Math.max(0, -(options.value?.customerBalanceCents ?? 0)),
)
const ceilingMinor = computed(() => options.value?.creditCeilingMinor ?? 0)
const isOverCeiling = computed(() => amountMinor.value > ceilingMinor.value)
const canSubmit = computed(
	() =>
		amountMinor.value > 0 &&
		!isOverCeiling.value &&
		reason.value.trim().length > 0 &&
		!isSubmitting.value,
)

function money(minor: number): string {
	return formatMinorUnits(minor, currency.value, locale.value)
}

const outcome = computed(() => {
	if (amountMinor.value <= 0) return null
	const credit = t(`${D}.outcome`, {
		name: props.workspaceName,
		amount: money(amountMinor.value),
	})
	const invoice = options.value?.nextInvoice
	if (!invoice) return credit
	const date = formatDate(invoice.date, locale.value, { dateStyle: 'medium' })
	const dropsTo = money(Math.max(0, invoice.amountMinor - amountMinor.value))
	return `${credit} ${t(`${D}.outcome_invoice`, { date, amount: dropsTo })}`
})

async function load(): Promise<void> {
	loadError.value = null
	try {
		options.value = await $authFetch<OperatorOptions>(
			`/api/saas/workspaces/${props.tenantId}/operator-options`,
		)
	} catch (error) {
		loadError.value = resolveApiError(error, `${D}.load_error`)
	}
}

function useMax(): void {
	amount.value = fromMinorUnits(ceilingMinor.value, currency.value)
}

async function submit(): Promise<void> {
	if (!canSubmit.value) return
	isSubmitting.value = true
	submitError.value = null
	try {
		await $authFetch(`/api/saas/workspaces/${props.tenantId}/balance-credit`, {
			method: 'POST',
			body: {
				operationId,
				amountCents: amountMinor.value,
				reason: reason.value.trim(),
			},
		})
		toast.add({
			title: t(`${D}.success`, { amount: money(amountMinor.value) }),
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
		<div v-else-if="!options" class="flex flex-col gap-3">
			<USkeleton class="h-10 w-full" />
			<USkeleton class="h-20 w-full" />
		</div>
		<DmsEmptyState
			v-else-if="ceilingMinor === 0"
			variant="no-access"
			size="sm"
			:title="$t(`${D}.unavailable_title`)"
			:description="$t(`${D}.unavailable_description`)"
		/>
		<template v-else>
			<FormRows has-required>
				<FormFieldRow
					:label="$t(`${D}.amount`)"
					:help="$t(`${D}.ceiling`, { amount: money(ceilingMinor) })"
					:error="isOverCeiling ? $t(`${D}.over_ceiling`) : undefined"
					required
				>
					<template #default="{ id }">
						<div class="flex items-center gap-2">
							<UInputNumber
								:id="id"
								v-model="amount"
								:min="0"
								:step="0.01"
								:format-options="{ minimumFractionDigits: 2 }"
								class="w-full"
								autofocus
							>
								<template #trailing>
									<span class="text-muted font-mono text-xs">
										{{ currency }}
									</span>
								</template>
							</UInputNumber>
							<UButton
								color="neutral"
								variant="outline"
								class="shrink-0"
								@click="useMax"
							>
								{{ $t(`${D}.use_max`) }}
							</UButton>
						</div>
					</template>
					<template #after>
						<p class="text-muted text-sm">
							{{
								$t(`${D}.balance`, {
									before: money(balanceMinor),
									after: money(balanceMinor + amountMinor),
								})
							}}
						</p>
					</template>
				</FormFieldRow>
				<FormFieldRow
					:label="$t(`${D}.reason`)"
					:help="
						$t(`${D}.reason_help`, {
							count: reason.length,
							max: REASON_MAX_LENGTH,
						})
					"
					required
				>
					<template #default="{ id }">
						<DmsTextarea
							:id="id"
							v-model="reason"
							:maxlength="REASON_MAX_LENGTH"
							:placeholder="$t(`${D}.reason_placeholder`)"
							autoresize
							class="w-full"
						/>
					</template>
				</FormFieldRow>
			</FormRows>
			<DmsBanner
				v-if="outcome"
				size="sm"
				tone="info"
				icon="i-ph-info"
				:title="outcome"
			/>
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
				icon="i-ph-coins"
				:loading="isSubmitting"
				:disabled="!canSubmit"
				@click="submit"
			>
				{{
					amountMinor > 0
						? $t(`${D}.submit_amount`, { amount: money(amountMinor) })
						: $t(`${D}.submit`)
				}}
			</UButton>
		</div>
	</div>
</template>
