<script setup lang="ts">
import {
	type FunctionalComponent,
	computed,
	ref,
	resolveComponent,
	watch,
} from 'vue'
import FormFieldRow from '../build/components/FormFieldRow.vue'
import FormRows from '../build/components/FormRows.vue'

/** The props of a group: a titled row of the card, or a stretch of rows. */
interface GroupBindings {
	label?: string
	description?: string
	layout?: 'form'
	class?: string
}

/** The props of the box around fields sharing a row, if any. */
interface ClusterBindings {
	class?: string
}

type VatBadgeTone = 'success' | 'warning'

const props = defineProps<{
	/** Fields flagged after a submit attempt. */
	invalidFields?: BillingIdentityField[]
	vatVerificationStatus?: VatVerificationStatus | null
	isLocked?: boolean
	/**
	 * One card whose rows are the groups, titled, their fields side by side
	 * (the billing page); one row per field otherwise (the upgrade dialog).
	 */
	sectioned?: boolean
}>()

const draft = defineModel<BillingIdentityDraft>({ required: true })

const CUSTOMER_TYPES: CustomerType[] = ['business', 'individual']
const CUSTOMER_TYPE_ICONS: Record<CustomerType, string> = {
	business: 'i-ph-buildings',
	individual: 'i-ph-user',
}
const VAT_BADGE_TONES: Record<VatVerificationStatus, VatBadgeTone> = {
	verified: 'success',
	pending: 'warning',
	unverified: 'warning',
}
const KEY_PREFIX = 'saas.tenant_billing.billing_info'
/** The required fields the address input holds, in its order. */
const ADDRESS_FIELDS: BillingIdentityField[] = [
	'line1',
	'postalCode',
	'city',
	'country',
]
/** The DMS address input's street search (its default geocoder). */
const ADDRESS_AUTOCOMPLETE = { enabled: true }
// Compact, the groups follow each other as one list of rows: a hairline
// above each group but the first, as between its rows.
const COMPACT_GROUP_CLASS = 'border-muted border-t first:border-t-0'

// Side by side once the row has room, as the settings design pairs fields
// (company name and VAT number).
const CLUSTER_CLASS = '@container'
const PAIR_GRID_CLASS = 'grid gap-3 @min-[420px]:grid-cols-2'

// Literal, so the build resolves the DMS field row at compile time.
const DmsFieldRowComponent = resolveComponent('DmsFieldRow')
const groupWrapper = computed(() =>
	props.sectioned ? DmsFieldRowComponent : 'div',
)
// Compact, the fields of a group are rows of their own: no box around them,
// which would also take the hairline off the first row it holds. Not
// `Fragment`: drawn as a component it drops the slot it is handed, and with it
// every field of the cluster.
const SlotPassthrough: FunctionalComponent = (_props, { slots }) =>
	slots.default?.()
const clusterWrapper = computed(() =>
	props.sectioned ? 'div' : SlotPassthrough,
)

const { t, locale } = useI18n()

const isBusiness = computed(() => draft.value.customerType === 'business')
const countryLabel = computed(() =>
	draft.value.country
		? formatBillingCountry(draft.value.country, locale.value)
		: '',
)

// The address input edits its own value, the street split in parts; the
// draft keeps the stored street line. Its value is read back from the draft
// only when the draft changed from elsewhere (loaded, discarded): re-split
// as the user types, a number typed in the street box would jump to the
// number box under the cursor.
const address = ref<AddressInputValue>(toAddressInputValue(draft.value))

function hasDraftAddress(next: BillingAddressDraft): boolean {
	return (Object.keys(next) as (keyof BillingAddressDraft)[]).every(
		(field) => next[field] === draft.value[field],
	)
}

function updateAddress(value: AddressInputValue | null | undefined): void {
	if (!value) return
	address.value = value
	draft.value = {
		...draft.value,
		...fromAddressInputValue(value, draft.value),
	}
}

watch(draft, () => {
	if (hasDraftAddress(fromAddressInputValue(address.value, draft.value)))
		return
	address.value = toAddressInputValue(draft.value)
})

function fieldError(field: BillingIdentityField): string | undefined {
	return props.invalidFields?.includes(field)
		? t(`${KEY_PREFIX}.errors.${field}`)
		: undefined
}

/** Every missing part of the address, one message each. */
const addressError = computed(() => {
	const messages = ADDRESS_FIELDS.map(fieldError).filter(Boolean)
	return messages.length > 0 ? messages.join(' ') : undefined
})

function selectCustomerType(customerType: CustomerType): void {
	if (props.isLocked) return
	draft.value = { ...draft.value, customerType }
}

function group(key: string): GroupBindings {
	if (!props.sectioned) return { class: COMPACT_GROUP_CLASS }
	return {
		label: t(`${KEY_PREFIX}.sections.${key}.title`),
		description: t(`${KEY_PREFIX}.sections.${key}.description`, {
			country: countryLabel.value,
		}),
		layout: 'form',
	}
}

function cluster(className: string): ClusterBindings {
	return props.sectioned ? { class: className } : {}
}
</script>

<template>
	<FormRows
		has-required
		:legend-class="sectioned ? 'px-[18px] pb-4' : undefined"
	>
		<component :is="groupWrapper" v-bind="group('customer_type')">
			<FormFieldRow
				:label="sectioned ? undefined : $t(`${KEY_PREFIX}.customer_type`)"
				:error="fieldError('customerType')"
				:stacked="sectioned"
				:labels-control="false"
			>
				<!-- Side by side once the control column has room for both cards,
					as the DMS choice cards lay out. -->
				<div class="@container">
					<div
						role="radiogroup"
						:aria-label="$t(`${KEY_PREFIX}.customer_type`)"
						class="@min-[480px]:grid-cols-2 grid gap-2"
					>
						<DmsCard
							v-for="customerType in CUSTOMER_TYPES"
							:key="customerType"
							as="button"
							type="button"
							role="radio"
							interactive
							:selected="draft.customerType === customerType"
							:aria-checked="draft.customerType === customerType"
							:disabled="isLocked"
							class="text-left disabled:cursor-default"
							@click="selectCustomerType(customerType)"
						>
							<span class="flex items-start gap-3">
								<UIcon
									:name="CUSTOMER_TYPE_ICONS[customerType]"
									class="text-muted mt-0.5 size-5"
								/>
								<span>
									<span class="block text-sm font-medium">
										{{
											$t(`${KEY_PREFIX}.customer_types.${customerType}.label`)
										}}
									</span>
									<span class="text-muted block text-xs">
										{{
											$t(`${KEY_PREFIX}.customer_types.${customerType}.hint`)
										}}
									</span>
								</span>
							</span>
						</DmsCard>
					</div>
				</div>
			</FormFieldRow>
		</component>

		<component :is="groupWrapper" v-if="isBusiness" v-bind="group('company')">
			<component :is="clusterWrapper" v-bind="cluster(CLUSTER_CLASS)">
				<component :is="clusterWrapper" v-bind="cluster(PAIR_GRID_CLASS)">
					<FormFieldRow
						:label="$t(`${KEY_PREFIX}.company_name`)"
						:error="fieldError('companyName')"
						:stacked="sectioned"
						required
					>
						<template #default="{ id }">
							<DmsInputText
								:id="id"
								v-model="draft.companyName"
								autocomplete="organization"
								:disabled="isLocked"
								class="w-full"
							/>
						</template>
					</FormFieldRow>
					<FormFieldRow
						:label="$t(`${KEY_PREFIX}.vat_number`)"
						:stacked="sectioned"
					>
						<template v-if="vatVerificationStatus" #label-extra>
							<DmsStatusPill
								:tone="VAT_BADGE_TONES[vatVerificationStatus]"
								:label="$t(`${KEY_PREFIX}.vat.${vatVerificationStatus}`)"
							/>
						</template>
						<template #default="{ id }">
							<DmsInputText
								:id="id"
								v-model="draft.vatNumber"
								:disabled="isLocked"
								class="w-full"
							/>
						</template>
					</FormFieldRow>
				</component>
			</component>
		</component>

		<component :is="groupWrapper" v-bind="group('address')">
			<FormFieldRow
				:label="sectioned ? undefined : $t(`${KEY_PREFIX}.sections.address.title`)"
				:description="
					sectioned ? undefined : $t(`${KEY_PREFIX}.sections.address.description`)
				"
				:error="addressError"
				:stacked="sectioned"
				required
			>
				<template #default="{ id }">
					<DmsInputAddress
						:id="id"
						:model-value="address"
						:autocomplete="ADDRESS_AUTOCOMPLETE"
						:disabled="isLocked"
						@update:model-value="updateAddress"
					/>
				</template>
			</FormFieldRow>
		</component>

		<component :is="groupWrapper" v-bind="group('email')">
			<FormFieldRow
				:label="sectioned ? undefined : $t(`${KEY_PREFIX}.billing_email`)"
				:description="
					sectioned ? undefined : $t(`${KEY_PREFIX}.billing_email_hint`)
				"
				:error="fieldError('billingEmail')"
				:stacked="sectioned"
				required
			>
				<template #default="{ id }">
					<DmsInputEmail
						:id="id"
						v-model="draft.billingEmail"
						:aria-label="$t(`${KEY_PREFIX}.billing_email`)"
						type="email"
						autocomplete="email"
						:disabled="isLocked"
						class="w-full"
					/>
				</template>
			</FormFieldRow>
		</component>
	</FormRows>
</template>
