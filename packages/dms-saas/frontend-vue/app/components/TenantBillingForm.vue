<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface BillingAddress {
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

type VatVerificationStatus = "pending" | "verified" | "unverified";

interface BillingInfoResponse {
  customerType: "individual" | "business" | null;
  companyName: string | null;
  vatNumber: string | null;
  vatVerificationStatus: VatVerificationStatus | null;
  billingEmail: string | null;
  address: BillingAddress | null;
}

const VAT_BADGE_COLORS: Record<VatVerificationStatus, "success" | "warning"> = {
  verified: "success",
  pending: "warning",
  unverified: "warning",
};

const BILLING_INFO_ENDPOINT = "/api/saas/tenant/billing-info";

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { countryItems } = useBillingCountries();
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus();

/** Saving is owner-only server-side; a member gets the form read-only
 * instead of a save button that can only end in a 403 toast. */
const isTenantOwner = computed(() => !!billingStatus.value?.isTenantOwner);

const customerType = ref<"individual" | "business" | null>(null);
const companyName = ref("");
const vatNumber = ref("");
const vatVerificationStatus = ref<VatVerificationStatus | null>(null);
const billingEmail = ref("");
const country = ref("");
const addressLine1 = ref("");
const postalCode = ref("");
const city = ref("");
const isLoading = ref(true);
const loadFailed = ref(false);
const isSaving = ref(false);

const isBusiness = computed(() => customerType.value === "business");

const customerTypeLabel = computed(() => {
  if (!customerType.value) return "—";
  return nuxtApp.$i18n.t(`saas.register.customer_type.${customerType.value}`);
});

async function load(): Promise<void> {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    const info = await $authFetch<BillingInfoResponse>(BILLING_INFO_ENDPOINT);
    customerType.value = info.customerType;
    companyName.value = info.companyName ?? "";
    vatNumber.value = info.vatNumber ?? "";
    vatVerificationStatus.value = info.vatVerificationStatus;
    billingEmail.value = info.billingEmail ?? "";
    country.value = info.address?.country ?? "";
    addressLine1.value = info.address?.line1 ?? "";
    postalCode.value = info.address?.postalCode ?? "";
    city.value = info.address?.city ?? "";
  } catch {
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

async function save(): Promise<void> {
  isSaving.value = true;
  try {
    const updated = await $authFetch<BillingInfoResponse>(
      BILLING_INFO_ENDPOINT,
      {
        method: "PUT",
        body: {
          companyName: isBusiness.value ? companyName.value : undefined,
          vatNumber: isBusiness.value ? vatNumber.value : undefined,
          billingEmail: billingEmail.value || null,
          address: {
            country: country.value || undefined,
            line1: addressLine1.value || undefined,
            postalCode: postalCode.value || undefined,
            city: city.value || undefined,
          },
        },
      },
    );
    customerType.value = updated.customerType;
    vatVerificationStatus.value = updated.vatVerificationStatus;
    toast.add({
      title: nuxtApp.$i18n.t("saas.workspace.billing.info_saved"),
      color: "success",
      icon: "i-ph-check-circle",
    });
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.billing.info_save_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  void loadBillingStatus();
  return load();
});
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h3 class="font-semibold">
          {{ $t("saas.workspace.billing.info_title") }}
        </h3>
        <p class="text-muted mt-1 text-sm">
          {{ $t("saas.workspace.billing.info_description") }}
        </p>
      </div>
    </template>

    <div v-if="isLoading" class="flex flex-col gap-3">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-full" />
    </div>

    <DmsSaasLoadFailure v-else-if="loadFailed" @retry="load" />

    <form v-else class="flex flex-col gap-4" @submit.prevent="save">
      <UFormField :label="$t('saas.register.customer_type.label')">
        <UBadge color="neutral" variant="subtle">
          {{ customerTypeLabel }}
        </UBadge>
      </UFormField>

      <template v-if="isBusiness">
        <UFormField :label="$t('saas.register.field.company_name')">
          <UInput v-model="companyName" class="w-full" />
        </UFormField>
        <UFormField :label="$t('saas.register.field.vat_number')">
          <div class="flex flex-wrap items-center gap-2">
            <UInput v-model="vatNumber" class="min-w-40 grow" />
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
      <UFormField :label="$t('saas.register.field.country')">
        <USelect v-model="country" :items="countryItems" class="w-full" />
      </UFormField>
      <UFormField :label="$t('saas.register.field.address_line1')">
        <UInput v-model="addressLine1" class="w-full" />
      </UFormField>
      <div class="grid grid-cols-2 gap-4">
        <UFormField :label="$t('saas.register.field.postal_code')">
          <UInput v-model="postalCode" class="w-full" />
        </UFormField>
        <UFormField :label="$t('saas.register.field.city')">
          <UInput v-model="city" class="w-full" />
        </UFormField>
      </div>

      <UFormField
        :label="$t('saas.workspace.billing.billing_email.label')"
        :description="$t('saas.workspace.billing.billing_email.hint')"
      >
        <UInput v-model="billingEmail" type="email" class="w-full" />
      </UFormField>

      <div v-if="isTenantOwner" class="flex justify-end">
        <UButton
          type="submit"
          color="primary"
          icon="i-ph-floppy-disk"
          :loading="isSaving"
        >
          {{ $t("saas.workspace.billing.info_save") }}
        </UButton>
      </div>
    </form>
  </UCard>
</template>
