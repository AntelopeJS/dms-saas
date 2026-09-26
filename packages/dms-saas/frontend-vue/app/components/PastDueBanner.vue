<script setup lang="ts">
import { computed, onMounted } from "vue";

const KEY_PREFIX = "saas.workspace.billing.past_due.banner";
const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
};

// Rendered as the content of the DMS layout banner registered server-side
// (see registerPastDueBanner), which already decided it shows and draws the
// alert chrome, icon and role around it.
const { data, load } = useBillingStatus();
const { formatMinorUnits } = useMoneyFormat();
const { t, locale } = useI18n();

// Owner-only in the API payload: a member gets the generic line and no
// settle button, the owner pays.
const invoice = computed(() => data.value?.unpaidInvoice ?? null);

const message = computed(() => {
  if (!invoice.value) return t(`${KEY_PREFIX}.generic`);
  const amount = formatMinorUnits(invoice.value.amount, invoice.value.currency);
  const subject = { invoice: invoice.value.number ?? amount, amount };
  const suspendOn = formatDate(
    invoice.value.suspendAt,
    locale.value,
    DEADLINE_FORMAT,
  );
  return suspendOn
    ? t(`${KEY_PREFIX}.with_deadline`, { ...subject, date: suspendOn })
    : t(`${KEY_PREFIX}.summary`, subject);
});

function settle(): void {
  const url = invoice.value?.hostedInvoiceUrl;
  if (!url || typeof window === "undefined") return;
  window.open(url, "_blank", "noopener");
}

onMounted(load);
</script>

<template>
  <div
    data-saas-past-due-banner
    class="flex flex-wrap items-center gap-x-3 gap-y-2"
  >
    <p class="min-w-0 grow">{{ message }}</p>
    <UButton
      v-if="invoice?.hostedInvoiceUrl"
      size="sm"
      color="error"
      variant="outline"
      trailing-icon="i-ph-arrow-square-out"
      @click="settle"
    >
      {{ $t(`${KEY_PREFIX}.settle`) }}
    </UButton>
  </div>
</template>
