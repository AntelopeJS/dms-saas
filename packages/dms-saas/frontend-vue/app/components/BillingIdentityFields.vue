<script setup lang="ts">
import { computed, resolveComponent } from 'vue'

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

function section(key: string) {
	return props.sectioned
		? {
				title: t(`${KEY_PREFIX}.sections.${key}.title`),
				description: t(`${KEY_PREFIX}.sections.${key}.description`, {
					country: countryLabel.value,
				}),
			}
		: null
}
</script>

<template>
	<div class="flex flex-col" :class="sectioned ? 'gap-0' : 'gap-4'">
		<component :is="groupWrapper" v-bind="section('customer_type') ?? {}">
			<div :class="sectioned ? 'p-4' : ''">
				<UFormField
					:label="sectioned ? undefined : $t(`${KEY_PREFIX}.customer_type`)"
					:error="fieldError('customerType')"
				>
					<div
						role="radiogroup"
						:aria-label="$t(`${KEY_PREFIX}.customer_type`)"
						class="grid gap-2 sm:grid-cols-2"
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
				</UFormField>
			</div>
		</component>

		<component
			:is="groupWrapper"
			v-if="isBusiness"
			v-bind="section('company') ?? {}"
		>
			<div class="flex flex-col gap-4" :class="sectioned ? 'p-4' : ''">
				<UFormField
					:label="$t(`${KEY_PREFIX}.company_name`)"
					:error="fieldError('companyName')"
					required
				>
					<UInput
						v-model="draft.companyName"
						autocomplete="organization"
						:disabled="isLocked"
						class="w-full"
					/>
				</UFormField>
				<UFormField
					:label="$t(`${KEY_PREFIX}.vat_number`)"
					:hint="$t(`${KEY_PREFIX}.optional`)"
				>
					<div class="flex flex-wrap items-center gap-2">
						<UInput
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
				</UFormField>
			</div>
		</component>

		<component :is="groupWrapper" v-bind="section('address') ?? {}">
			<div class="flex flex-col gap-4" :class="sectioned ? 'p-4' : ''">
				<UFormField
					:label="$t(`${KEY_PREFIX}.address_line1`)"
					:error="fieldError('line1')"
					required
				>
					<UInput
						v-model="draft.line1"
						autocomplete="address-line1"
						:disabled="isLocked"
						class="w-full"
					/>
				</UFormField>
				<div class="grid gap-4 sm:grid-cols-2">
					<UFormField
						:label="$t(`${KEY_PREFIX}.postal_code`)"
						:error="fieldError('postalCode')"
						required
					>
						<UInput
							v-model="draft.postalCode"
							autocomplete="postal-code"
							:disabled="isLocked"
							class="w-full"
						/>
					</UFormField>
					<UFormField
						:label="$t(`${KEY_PREFIX}.city`)"
						:error="fieldError('city')"
						required
					>
						<UInput
							v-model="draft.city"
							autocomplete="address-level2"
							:disabled="isLocked"
							class="w-full"
						/>
					</UFormField>
				</div>
				<UFormField
					:label="$t(`${KEY_PREFIX}.country`)"
					:error="fieldError('country')"
					required
				>
					<USelectMenu
						v-model="draft.country"
						:items="countryItems"
						value-key="value"
						:disabled="isLocked"
						:placeholder="$t(`${KEY_PREFIX}.country_placeholder`)"
						class="w-full"
					/>
				</UFormField>
			</div>
		</component>

		<component :is="groupWrapper" v-bind="section('email') ?? {}">
			<div :class="sectioned ? 'p-4' : ''">
				<UFormField
					:label="sectioned ? undefined : $t(`${KEY_PREFIX}.billing_email`)"
					:description="
						sectioned ? undefined : $t(`${KEY_PREFIX}.billing_email_hint`)
					"
					:error="fieldError('billingEmail')"
					required
				>
					<UInput
						v-model="draft.billingEmail"
						type="email"
						autocomplete="email"
						:disabled="isLocked"
						class="w-full"
					/>
				</UFormField>
			</div>
		</component>
	</div>
</template>
