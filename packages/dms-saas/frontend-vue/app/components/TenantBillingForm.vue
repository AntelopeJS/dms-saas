<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const KEY_PREFIX = 'saas.tenant_billing.billing_info'
const DAY_FORMAT: Intl.DateTimeFormatOptions = {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
}
const DRAFT_FIELDS: (keyof BillingIdentityDraft)[] = [
	'customerType',
	'companyName',
	'vatNumber',
	'line1',
	'postalCode',
	'city',
	'country',
	'billingEmail',
]

const toast = useToast()
const { t, locale } = useI18n()
const { resolveApiError } = useApiErrorMessage()
const identity = useBillingIdentity()
const info = useBillingInfo()
const { data: billingStatus } = useBillingStatus()

/** Saving is owner-only server-side; a member gets the form read-only
 * instead of a save button that can only end in a 403 toast. */
const isTenantOwner = computed(() => !!billingStatus.value?.isTenantOwner)

const draft = ref<BillingIdentityDraft>(emptyBillingIdentityDraft())
const saved = ref<BillingIdentityDraft>(emptyBillingIdentityDraft())
const savedMissingFields = ref<BillingIdentityField[]>([])
const vatVerificationStatus = ref<VatVerificationStatus | null>(null)
const savedAt = ref<string | null>(null)
const hasTriedSubmit = ref(false)
// Flagged once a submit was attempted, then re-checked as the user types so
// a corrected field clears its error right away.
const invalidFields = computed<BillingIdentityField[]>(() =>
	hasTriedSubmit.value ? findMissingBillingFields(draft.value) : [],
)
const isLoading = computed(() => info.pending.value && !info.data.value)
const loadFailed = computed(() => !!info.error.value && !info.data.value)
const isSaving = ref(false)

/** The badge reflects what is stored, not what is being typed. */
const isIncomplete = computed(() => savedMissingFields.value.length > 0)
const changedFields = computed(() =>
	DRAFT_FIELDS.filter((field) => draft.value[field] !== saved.value[field]),
)
const changeLabels = computed(() =>
	changedFields.value.map((field) => t(`${KEY_PREFIX}.field_labels.${field}`)),
)
const savedLabel = computed(() =>
	formatDate(savedAt.value, locale.value, DAY_FORMAT),
)

function apply(info: BillingInfoResponse): void {
	draft.value = toBillingIdentityDraft(info)
	saved.value = toBillingIdentityDraft(info)
	savedMissingFields.value = info.missingFields
	vatVerificationStatus.value = info.vatVerificationStatus
	savedAt.value = info.updatedAt ?? null
	hasTriedSubmit.value = false
}

function load(): Promise<void> {
	return info.refresh()
}

function discard(): void {
	draft.value = { ...saved.value }
	hasTriedSubmit.value = false
}

async function save(): Promise<void> {
	hasTriedSubmit.value = true
	if (invalidFields.value.length > 0) {
		toast.add({
			title: t(`${KEY_PREFIX}.incomplete_toast`),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
		return
	}
	isSaving.value = true
	try {
		info.data.value = await identity.save(draft.value)
		toast.add({
			title: t(`${KEY_PREFIX}.saved`),
			color: 'success',
			icon: 'i-ph-check-circle',
		})
	} catch (error) {
		toast.add({
			title: resolveApiError(error, `${KEY_PREFIX}.save_error`),
			color: 'error',
			icon: 'i-ph-warning-circle',
		})
	} finally {
		isSaving.value = false
	}
}

// The fields are copies of the stored identity, edited in place: copied once
// it is read (awaited, so the server renders them filled in), then each time
// it is read or saved again.
watch(info.data, (stored) => stored && apply(stored))
await info
if (info.data.value) apply(info.data.value)
</script>

<template>
	<form id="saas-billing-info-form" novalidate @submit.prevent="save">
		<DmsSection
			:title="$t(`${KEY_PREFIX}.title`)"
			:description="$t(`${KEY_PREFIX}.description`)"
		>
			<template #trail>
				<DmsStatusPill
					v-if="!isLoading && !loadFailed && isIncomplete"
					tone="warning"
					:label="$t(`${KEY_PREFIX}.to_complete`)"
				/>
				<span v-else-if="savedLabel" class="text-muted text-xs">
					{{ $t(`${KEY_PREFIX}.saved_on`, { date: savedLabel }) }}
				</span>
			</template>

			<div v-if="isLoading" class="flex flex-col gap-3 p-[18px]">
				<USkeleton class="h-16 w-full" />
				<USkeleton class="h-10 w-full" />
				<USkeleton class="h-10 w-full" />
			</div>

			<div v-else-if="loadFailed" class="p-[18px]">
				<DmsSaasLoadFailure
					:title="$t(`${KEY_PREFIX}.load_failed`)"
					@retry="load"
				/>
			</div>

			<DmsSaasBillingIdentityFields
				v-else
				v-model="draft"
				sectioned
				:invalid-fields="invalidFields"
				:vat-verification-status="vatVerificationStatus"
				:is-locked="!isTenantOwner"
			/>
		</DmsSection>
		<DmsSaveBar
			v-if="isTenantOwner && !isLoading && !loadFailed"
			:dirty="changedFields.length > 0"
			:saving="isSaving"
			:changes="changeLabels"
			form="saas-billing-info-form"
			:save-label="$t(`${KEY_PREFIX}.save`)"
			@discard="discard"
		/>
		<p v-else-if="!isLoading && !loadFailed" class="text-muted mt-3 text-sm">
			{{ $t(`${KEY_PREFIX}.owner_only`) }}
		</p>
	</form>
</template>
