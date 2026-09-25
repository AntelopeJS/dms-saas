<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const toast = useToast();
const { t } = useI18n();
const { resolveApiError } = useApiErrorMessage();
const identity = useBillingIdentity();
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus();

/** Saving is owner-only server-side; a member gets the form read-only
 * instead of a save button that can only end in a 403 toast. */
const isTenantOwner = computed(() => !!billingStatus.value?.isTenantOwner);

const draft = ref<BillingIdentityDraft>(emptyBillingIdentityDraft());
const savedMissingFields = ref<BillingIdentityField[]>([]);
const vatVerificationStatus = ref<VatVerificationStatus | null>(null);
const hasTriedSubmit = ref(false);
// Flagged once a submit was attempted, then re-checked as the user types so
// a corrected field clears its error right away.
const invalidFields = computed<BillingIdentityField[]>(() =>
  hasTriedSubmit.value ? findMissingBillingFields(draft.value) : [],
);
const isLoading = ref(true);
const loadFailed = ref(false);
const isSaving = ref(false);

/** The badge reflects what is stored, not what is being typed. */
const isIncomplete = computed(() => savedMissingFields.value.length > 0);

function apply(info: BillingInfoResponse): void {
  draft.value = toBillingIdentityDraft(info);
  savedMissingFields.value = info.missingFields;
  vatVerificationStatus.value = info.vatVerificationStatus;
}

async function load(): Promise<void> {
  isLoading.value = true;
  loadFailed.value = false;
  try {
    apply(await identity.load());
  } catch {
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

async function save(): Promise<void> {
  hasTriedSubmit.value = true;
  if (invalidFields.value.length > 0) {
    toast.add({
      title: t("saas.workspace.billing.identity.incomplete_toast"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    return;
  }
  isSaving.value = true;
  try {
    apply(await identity.save(draft.value));
    toast.add({
      title: t("saas.workspace.billing.info_saved"),
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
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="font-semibold">
            {{ $t("saas.workspace.billing.info_title") }}
          </h3>
          <p class="text-muted mt-1 text-sm">
            {{ $t("saas.workspace.billing.info_description") }}
          </p>
        </div>
        <UBadge
          v-if="!isLoading && !loadFailed && isIncomplete"
          color="warning"
          variant="subtle"
        >
          {{ $t("saas.workspace.billing.identity.to_complete") }}
        </UBadge>
      </div>
    </template>

    <div v-if="isLoading" class="flex flex-col gap-3">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-full" />
    </div>

    <DmsSaasLoadFailure v-else-if="loadFailed" @retry="load" />

    <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="save">
      <DmsSaasBillingIdentityFields
        v-model="draft"
        :invalid-fields="invalidFields"
        :vat-verification-status="vatVerificationStatus"
        :is-locked="!isTenantOwner"
      />

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
