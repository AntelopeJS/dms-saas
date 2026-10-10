<script setup lang="ts">
import { computed, resolveComponent } from 'vue'
import FormFieldRow from '../build/components/FormFieldRow.vue'
import FormRows from '../build/components/FormRows.vue'

type AddressField = Extract<
	BillingIdentityField,
	'line1' | 'postalCode' | 'city'
>

interface AddressFieldRow {
	id: AddressField
	/** Key of the label, under the billing info texts. */
	label: string
	autocomplete: string
}

/** The props of a group: a titled section, or a stretch of rows. */
interface GroupBindings {
	title?: string
	description?: string
	class?: string
}

type VatBadgeTone = 'success' | 'warning'

const props = defineProps<{
	/** Fields flagged after a submit attempt. */
	invalidFields?: BillingIdentityField[]
	vatVerificationStatus?: VatVerificationStatus | null
	isLocked?: boolean
	/**
	 * One titled section per group (the billing page); compact stacked fields
	 * otherwise (the upgrade dialog).
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
const ADDRESS_FIELDS: AddressFieldRow[] = [
	{ id: 'line1', label: 'address_line1', autocomplete: 'address-line1' },
	{ id: 'postalCode', label: 'postal_code', autocomplete: 'postal-code' },
	{ id: 'city', label: 'city', autocomplete: 'address-level2' },
]
// Compact, the groups follow each other as one list of rows: a hairline
// above each group but the first, as between its rows.
const COMPACT_GROUP_CLASS = 'border-muted border-t first:border-t-0'

// Literal, so the build resolves the DMS section at compile time.
const DmsSectionComponent = resolveComponent('DmsSection')
const groupWrapper = computed(() =>
	props.sectioned ? DmsSectionComponent : 'div',
)

const { countryItems } = useBillingCountries()
const { t } = useI18n()

const isBusiness = computed(() => draft.value.customerType === 'business')
const countryLabel = computed(
	() =>
		countryItems.value.find((item) => item.value === draft.value.country)
			?.label ?? '',
)

function fieldError(field: BillingIdentityField): string | undefined {
	return props.invalidFields?.includes(field)
		? t(`${KEY_PREFIX}.errors.${field}`)
		: undefined
}

function selectCustomerType(customerType: CustomerType): void {
	if (props.isLocked) return
	draft.value = { ...draft.value, customerType }
}

function group(key: string): GroupBindings {
	if (!props.sectioned) return { class: COMPACT_GROUP_CLASS }
	return {
		title: t(`${KEY_PREFIX}.sections.${key}.title`),
		description: t(`${KEY_PREFIX}.sections.${key}.description`, {
			country: countryLabel.value,
		}),
	}
}
</script>

<template>
	<FormRows has-required :legend-class="sectioned ? 'pt-3' : undefined">
		<component :is="groupWrapper" v-bind="group('customer_type')">
			<FormFieldRow
				:label="sectioned ? undefined : $t(`${KEY_PREFIX}.customer_type`)"
				:error="fieldError('customerType')"
				:inset="sectioned"
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
			<FormFieldRow
				:label="$t(`${KEY_PREFIX}.company_name`)"
				:error="fieldError('companyName')"
				:inset="sectioned"
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
			<FormFieldRow :label="$t(`${KEY_PREFIX}.vat_number`)" :inset="sectioned">
				<template #default="{ id }">
					<div class="flex flex-wrap items-center gap-2">
						<DmsInputText
							:id="id"
							v-model="draft.vatNumber"
							:disabled="isLocked"
							class="min-w-40 grow"
						/>
						<DmsStatusPill
							v-if="vatVerificationStatus"
							:tone="VAT_BADGE_TONES[vatVerificationStatus]"
							:label="$t(`${KEY_PREFIX}.vat.${vatVerificationStatus}`)"
						/>
					</div>
				</template>
			</FormFieldRow>
		</component>

		<component :is="groupWrapper" v-bind="group('address')">
			<FormFieldRow
				v-for="field in ADDRESS_FIELDS"
				:key="field.id"
				:label="$t(`${KEY_PREFIX}.${field.label}`)"
				:error="fieldError(field.id)"
				:inset="sectioned"
				required
			>
				<template #default="{ id }">
					<DmsInputText
						:id="id"
						v-model="draft[field.id]"
						:autocomplete="field.autocomplete"
						:disabled="isLocked"
						class="w-full"
					/>
				</template>
			</FormFieldRow>
			<FormFieldRow
				:label="$t(`${KEY_PREFIX}.country`)"
				:error="fieldError('country')"
				:inset="sectioned"
				required
			>
				<template #default="{ id }">
					<USelectMenu
						:id="id"
						v-model="draft.country"
						:items="countryItems"
						value-key="value"
						:disabled="isLocked"
						:placeholder="$t(`${KEY_PREFIX}.country_placeholder`)"
						class="w-full"
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
				:inset="sectioned"
				required
			>
				<template #default="{ id }">
					<DmsInputEmail
						:id="id"
						v-model="draft.billingEmail"
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
