<script setup lang="ts">
import { computed, ref, watch } from "vue";

interface InvoiceRowData {
  _id?: string;
  number?: string | null;
  amount?: number;
}

const CREDIT_NOTE_ISSUE_ENDPOINT = "/api/saas/credit-notes/issue";
const CENTS_PER_UNIT = 100;
const CREDIT_MODE_BALANCE = "credit_to_balance";
const CREDIT_MODE_REFUND = "refund";

const props = defineProps<{
  rowData?: InvoiceRowData;
  onSuccessCallback?: () => void;
}>();

const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { $authFetch } = useAuthFetch();

const invoiceId = computed(() => props.rowData?._id ?? "");
const invoiceNumber = computed(() => props.rowData?.number ?? "—");
const maxAmount = computed(() => props.rowData?.amount ?? 0);

const amount = ref<number>(maxAmount.value);
const mode = ref<"credit_to_balance" | "refund">(CREDIT_MODE_BALANCE);
const reason = ref("");
const isSubmitting = ref(false);

// Keep the amount in sync if the component instance is reused for another
// invoice row without remounting, otherwise it keeps the previous invoice's
// amount and the submit button silently disables.
watch(maxAmount, (value) => {
  amount.value = value;
});

const modeItems = computed(() => [
  {
    value: CREDIT_MODE_BALANCE,
    label: nuxtApp.$i18n.t("saas.credit_notes.modal.mode.credit_to_balance"),
  },
  {
    value: CREDIT_MODE_REFUND,
    label: nuxtApp.$i18n.t("saas.credit_notes.modal.mode.refund"),
  },
]);

const isInvalid = computed(
  () =>
    !invoiceId.value ||
    amount.value <= 0 ||
    amount.value > maxAmount.value ||
    reason.value.trim().length === 0,
);

async function submit(): Promise<void> {
  if (isInvalid.value) return;
  isSubmitting.value = true;
  try {
    await $authFetch(CREDIT_NOTE_ISSUE_ENDPOINT, {
      method: "POST",
      body: {
        invoiceId: invoiceId.value,
        amount: amount.value,
        mode: mode.value,
        reason: reason.value.trim(),
      },
    });
    toast.add({
      title: nuxtApp.$i18n.t("saas.credit_notes.modal.success"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    props.onSuccessCallback?.();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.credit_notes.modal.error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <p class="text-muted text-sm">
      {{
        $t("saas.credit_notes.modal.description", {
          number: invoiceNumber,
          max: (maxAmount / CENTS_PER_UNIT).toFixed(2),
        })
      }}
    </p>
    <UFormField :label="$t('saas.credit_notes.modal.amount')">
      <UInput
        v-model="amount"
        type="number"
        :min="1"
        :max="maxAmount"
        class="w-full"
      />
    </UFormField>
    <UFormField :label="$t('saas.credit_notes.modal.mode_label')">
      <URadioGroup v-model="mode" :items="modeItems" />
    </UFormField>
    <UFormField :label="$t('saas.credit_notes.modal.reason')">
      <UInput v-model="reason" required class="w-full" />
    </UFormField>
    <div class="flex justify-end">
      <UButton
        type="submit"
        color="primary"
        icon="i-ph-receipt-x"
        :disabled="isInvalid"
        :loading="isSubmitting"
      >
        {{ $t("saas.credit_notes.modal.submit") }}
      </UButton>
    </div>
  </form>
</template>
