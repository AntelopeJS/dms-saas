<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus()

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
const isLoading = ref(true)
const loadFailed = ref(false)
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

async function load(): Promise<void> {
	isLoading.value = true
	loadFailed.value = false
	try {
		apply(await identity.load())
	} catch {
		loadFailed.value = true
	} finally {
		isLoading.value = false
	}
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
		apply(await identity.save(draft.value))
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

onMounted(() => {
	void loadBillingStatus()
	return load()
})
</script>

<template>
	<section class="flex flex-col gap-3" :aria-label="$t(`${KEY_PREFIX}.title`)">
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div>
				<h3 class="text-highlighted text-[15px] font-semibold">
					{{ $t(`${KEY_PREFIX}.title`) }}
				</h3>
				<p class="text-muted text-sm">{{ $t(`${KEY_PREFIX}.description`) }}</p>
			</div>
			<DmsStatusPill
				v-if="!isLoading && !loadFailed && isIncomplete"
				tone="warning"
				:label="$t(`${KEY_PREFIX}.to_complete`)"
			/>
			<span v-else-if="savedLabel" class="text-muted text-xs">
				{{ $t(`${KEY_PREFIX}.saved_on`, { date: savedLabel }) }}
			</span>
		</div>

		<DmsCard v-if="isLoading">
			<div class="flex flex-col gap-3">
				<USkeleton class="h-16 w-full" />
				<USkeleton class="h-10 w-full" />
				<USkeleton class="h-10 w-full" />
			</div>
		</DmsCard>

		<DmsSaasLoadFailure
			v-else-if="loadFailed"
			:title="$t(`${KEY_PREFIX}.load_failed`)"
			@retry="load"
		/>

		<form v-else id="saas-billing-info-form" novalidate @submit.prevent="save">
			<DmsSaasBillingIdentityFields
				v-model="draft"
				sectioned
				:invalid-fields="invalidFields"
				:vat-verification-status="vatVerificationStatus"
				:is-locked="!isTenantOwner"
			/>
			<DmsSaveBar
				v-if="isTenantOwner"
				:dirty="changedFields.length > 0"
				:saving="isSaving"
				:changes="changeLabels"
				form="saas-billing-info-form"
				:save-label="$t(`${KEY_PREFIX}.save`)"
				@discard="discard"
			/>
			<p v-else class="text-muted mt-3 text-sm">
				{{ $t(`${KEY_PREFIX}.owner_only`) }}
			</p>
		</form>
	</section>
</template>
