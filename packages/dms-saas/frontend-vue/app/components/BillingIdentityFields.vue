<script setup lang="ts">
import { computed } from "vue";

type VatBadgeColor = "success" | "warning";

const props = defineProps<{
  /** Fields flagged after a submit attempt. */
  invalidFields?: BillingIdentityField[];
  vatVerificationStatus?: VatVerificationStatus | null;
  isLocked?: boolean;
}>();

const draft = defineModel<BillingIdentityDraft>({ required: true });

const CUSTOMER_TYPES: CustomerType[] = ["business", "individual"];
const VAT_BADGE_COLORS: Record<VatVerificationStatus, VatBadgeColor> = {
  verified: "success",
  pending: "warning",
  unverified: "warning",
};
const FIELD_KEY_PREFIX = "saas.workspace.billing.identity";

const { countryItems } = useBillingCountries();
const { t } = useI18n();

const isBusiness = computed(() => draft.value.customerType === "business");

function fieldError(field: BillingIdentityField): string | undefined {
  return props.invalidFields?.includes(field)
    ? t(`${FIELD_KEY_PREFIX}.errors.${field}`)
    : undefined;
}

function selectCustomerType(customerType: CustomerType): void {
  if (props.isLocked) return;
  draft.value = { ...draft.value, customerType };
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UFormField
      :label="$t('saas.register.customer_type.label')"
      :error="fieldError('customerType')"
    >
      <div
        role="radiogroup"
        :aria-label="$t('saas.register.customer_type.label')"
        class="grid gap-2 sm:grid-cols-2"
      >
        <button
          v-for="customerType in CUSTOMER_TYPES"
          :key="customerType"
          type="button"
          role="radio"
          :aria-checked="draft.customerType === customerType"
          :disabled="isLocked"
          class="rounded-lg border p-3 text-left transition-colors disabled:cursor-default"
          :class="
            draft.customerType === customerType
              ? 'border-primary bg-primary/5'
              : 'border-default hover:bg-elevated/50'
          "
          @click="selectCustomerType(customerType)"
        >
          <span class="block text-sm font-medium">
            {{ $t(`saas.register.customer_type.${customerType}`) }}
          </span>
          <span class="text-muted block text-xs">
            {{ $t(`${FIELD_KEY_PREFIX}.customer_type_hint.${customerType}`) }}
          </span>
        </button>
      </div>
    </UFormField>

    <template v-if="isBusiness">
      <UFormField
        :label="$t('saas.register.field.company_name')"
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
        :label="$t('saas.register.field.vat_number')"
        :hint="$t(`${FIELD_KEY_PREFIX}.optional`)"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="draft.vatNumber"
            :disabled="isLocked"
            class="min-w-40 grow"
          />
          <UBadge
            v-if="vatVerificationStatus"
            :color="VAT_BADGE_COLORS[vatVerificationStatus]"
            variant="subtle"
          >
            {{ $t(`saas.workspace.billing.vat.${vatVerificationStatus}`) }}
          </UBadge>
        </div>
      </UFormField>
    </template>

    <h4 class="font-semibold">{{ $t("saas.register.billing_address") }}</h4>
    <UFormField
      :label="$t('saas.register.field.country')"
      :error="fieldError('country')"
      required
    >
      <USelectMenu
        v-model="draft.country"
        :items="countryItems"
        value-key="value"
        :disabled="isLocked"
        :placeholder="$t(`${FIELD_KEY_PREFIX}.country_placeholder`)"
        class="w-full"
      />
    </UFormField>
    <UFormField
      :label="$t('saas.register.field.address_line1')"
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
        :label="$t('saas.register.field.postal_code')"
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
        :label="$t('saas.register.field.city')"
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
      :label="$t('saas.workspace.billing.billing_email.label')"
      :description="$t('saas.workspace.billing.billing_email.hint')"
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
</template>
