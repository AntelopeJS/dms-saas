<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
	CREDIT_REASONS,
	type CreditNotePreview,
	INTERNAL_MEMO_MAX_LENGTH,
	useCreditNoteDraft,
} from '../build/composables/useCreditNoteDraft'
import { useCreditNoteTexts } from '../build/composables/useCreditNoteTexts'
import CreditNoteInvoiceSummary from '../build/components/CreditNoteInvoiceSummary.vue'

interface InvoiceRowData {
	_id?: string
}

interface IssuedCreditNote {
	number: string
}

const props = defineProps<{
	rowData?: InvoiceRowData
	onSuccessCallback?: () => void
}>()
const emit = defineEmits<{ success: [] }>()

const TEXT = 'saas.operator_billing.credit_modal'
const PREVIEW_ENDPOINT = '/api/saas/credit-notes/preview'
const ISSUE_ENDPOINT = '/api/saas/credit-notes/issue'

const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const { $authFetch } = useAuthFetch()
const { resolveApiError } = useApiErrorMessage()

const preview = ref<CreditNotePreview | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const isSubmitting = ref(false)
const requestId = crypto.randomUUID()

const draft = useCreditNoteDraft(preview)
const { mode, amount, reason, memo } = draft
const texts = useCreditNoteTexts({
	preview,
	mode,
	amountMinor: draft.amountMinor,
	creditedAfter: draft.creditedAfter,
})

async function load(): Promise<void> {
	const invoiceId = props.rowData?._id
	isLoading.value = true
	loadError.value = null
	try {
		preview.value = await $authFetch<CreditNotePreview>(
			`${PREVIEW_ENDPOINT}/${encodeURIComponent(invoiceId ?? '')}`,
		)
		draft.reset(preview.value)
	} catch (error) {
		loadError.value = resolveApiError(error, `${TEXT}.load_failed`)
	} finally {
		isLoading.value = false
	}
}

onMounted(load)

const blockedMessage = computed(() => {
	const reasonKey = preview.value?.blockReason
	if (!reasonKey) return null
	return t(`${TEXT}.blocked.${reasonKey}`, {
		date: texts.day(preview.value?.invoice.autoFinalizesAt),
	})
})

const reasonItems = computed(() =>
	CREDIT_REASONS.map((value) => ({
		value,
		label: t(`saas.operator_billing.credit_reasons.${value}`),
	})),
)

const ceilingError = computed(() => {
	if (!draft.isAboveCeiling.value || !preview.value) return undefined
	const prior = preview.value.priorCredits.filter(
		(note) => note.status === 'issued',
	)
	const max = texts.money(preview.value.creditable)
	if (prior.length === 0) return t(`${TEXT}.above_ceiling`, { max })
	return t(`${TEXT}.above_ceiling_credited`, {
		max,
		credited: texts.money(preview.value.credited),
		numbers: prior.map((note) => note.number).join(', '),
	})
})

function close(): void {
	emit('success')
}

async function issue(): Promise<IssuedCreditNote> {
	return $authFetch<IssuedCreditNote>(ISSUE_ENDPOINT, {
		method: 'POST',
		body: {
			invoiceId: preview.value?.invoice._id,
			amount: draft.amountMinor.value,
			mode: mode.value,
			reason: reason.value,
			memo: memo.value.trim() || undefined,
			requestId,
		},
	})
}

function announce(issued: IssuedCreditNote): void {
	toast.add({
		title: t(`${TEXT}.success`, { number: issued.number }),
		description: t(`${TEXT}.success_description`),
		color: 'success',
		icon: 'i-ph-check-circle',
	})
	props.onSuccessCallback?.()
}

async function confirmRefund(): Promise<void> {
	let issued: IssuedCreditNote | undefined
	const isConfirmed = await confirm({
		title: t(`${TEXT}.refund_confirm.title`, {
			amount: texts.amount.value,
			card: texts.card.value,
		}),
		description: t(`${TEXT}.refund_confirm.description`),
		color: 'error',
		initialFocus: 'cancel',
		confirmLabel: t(`${TEXT}.refund_confirm.confirm`, {
			amount: texts.amount.value,
		}),
		cancelLabel: t(`${TEXT}.refund_confirm.back`),
		impact: [
			{
				icon: 'i-ph-buildings',
				label: preview.value?.workspaceName ?? '',
				count: texts.amount.value,
			},
			{
				icon: 'i-ph-receipt',
				label: t(`${TEXT}.refund_confirm.credited_in_total`, {
					number: texts.outcomeParams.value.number,
				}),
				count: texts.outcomeParams.value.credited,
			},
		],
		onConfirm: async () => {
			issued = await issue()
		},
	})
	if (isConfirmed && issued) announce(issued)
}

async function creditDirectly(): Promise<void> {
	isSubmitting.value = true
	try {
		announce(await issue())
	} catch (error) {
		toast.add({
			title: resolveApiError(error, `${TEXT}.error`),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	} finally {
		isSubmitting.value = false
	}
}

function submit(): Promise<void> | undefined {
	if (!draft.canSubmit.value) return undefined
	return mode.value === 'refund' ? confirmRefund() : creditDirectly()
}
</script>

<template>
	<div class="flex flex-col gap-5">
		<div v-if="isLoading" class="flex flex-col gap-3">
			<USkeleton class="h-4 w-2/3" />
			<USkeleton class="h-32 w-full" />
			<USkeleton class="h-16 w-full" />
		</div>

		<DmsSaasLoadFailure
			v-else-if="loadError"
			:title="loadError"
			@retry="load"
		/>

		<template v-else-if="preview">
			<p class="text-muted text-sm">{{ texts.subtitle.value }}</p>

			<CreditNoteInvoiceSummary :preview="preview" />

			<UAlert
				v-if="blockedMessage"
				color="neutral"
				variant="subtle"
				icon="i-ph-info"
				:title="blockedMessage"
			/>

			<form v-else class="flex flex-col gap-5" @submit.prevent="submit">
				<UFormField :label="$t(`${TEXT}.mode_label`)">
					<URadioGroup
						v-model="mode"
						variant="card"
						:items="texts.modeItems.value"
						class="w-full"
					/>
				</UFormField>

				<UFormField
					:label="$t(`${TEXT}.amount`)"
					:help="
						$t(`${TEXT}.amount_help`, {
							max: texts.money(preview.creditable),
						})
					"
					:error="ceilingError"
					required
				>
					<div class="flex flex-wrap items-center gap-3">
						<UFieldGroup class="w-56">
							<UInputNumber
								v-model="amount"
								:min="0"
								:step="0.01"
								:increment="false"
								:decrement="false"
								:format-options="{
									style: 'currency',
									currency: draft.currency.value.toUpperCase(),
								}"
								class="flex-1"
							/>
							<UBadge
								color="neutral"
								variant="outline"
								size="lg"
								:label="draft.currency.value.toUpperCase()"
							/>
						</UFieldGroup>
						<UButton
							variant="link"
							color="primary"
							size="sm"
							@click="draft.useMax"
						>
							{{
								$t(`${TEXT}.use_max`, {
									max: texts.money(preview.creditable),
								})
							}}
						</UButton>
					</div>
				</UFormField>

				<UFormField :label="$t(`${TEXT}.reason`)" required>
					<USelect
						v-model="reason"
						:items="reasonItems"
						:placeholder="$t(`${TEXT}.reason_placeholder`)"
						class="w-full"
					/>
				</UFormField>

				<UFormField
					:label="$t(`${TEXT}.memo`)"
					:hint="$t(`${TEXT}.memo_hint`)"
					:error="
						draft.isMemoTooLong.value
							? $t(`${TEXT}.memo_too_long`, {
									max: INTERNAL_MEMO_MAX_LENGTH,
								})
							: undefined
					"
				>
					<UTextarea v-model="memo" :rows="3" autoresize class="w-full" />
				</UFormField>

				<UAlert
					color="primary"
					variant="subtle"
					icon="i-ph-arrow-u-down-left"
					:title="texts.outcome.value"
					:description="$t(`${TEXT}.creates`)"
				/>

				<div class="flex justify-end gap-2">
					<UButton color="neutral" variant="ghost" @click="close">
						{{ $t(`${TEXT}.cancel`) }}
					</UButton>
					<UButton
						type="submit"
						:color="mode === 'refund' ? 'error' : 'primary'"
						icon="i-ph-receipt-x"
						:disabled="!draft.canSubmit.value"
						:loading="isSubmitting"
					>
						{{ texts.submitLabel.value }}
					</UButton>
				</div>
			</form>
		</template>
	</div>
</template>
