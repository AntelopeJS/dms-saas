<script setup lang="ts">
import { computed, onMounted } from "vue";

const SUSPENDED_STATUS = "suspended";
const KEY_PREFIX = "saas.workspace.billing.past_due";
const DEADLINE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
};

const { data, error, load, refresh } = useBillingStatus();
const { formatMinorUnits } = useMoneyFormat();
const { t, locale } = useI18n();

const invoice = computed(() => data.value?.unpaidInvoice ?? null);
const isSuspended = computed(() => data.value?.status === SUSPENDED_STATUS);

function formatDay(value: string | null | undefined): string | null {
  return formatDate(value, locale.value, DEADLINE_FORMAT);
}

const amountLabel = computed(() =>
  formatMinorUnits(invoice.value?.amount, invoice.value?.currency),
);
const invoiceLabel = computed(() => invoice.value?.number ?? amountLabel.value);

const heading = computed(() =>
  isSuspended.value
    ? { title: `${KEY_PREFIX}.suspended_title`, badge: `${KEY_PREFIX}.suspended_badge` }
    : { title: `${KEY_PREFIX}.title`, badge: `${KEY_PREFIX}.badge` },
);

/**
 * The banner is one paragraph assembled from what is actually known: the
 * failure date, Stripe's next attempt and the suspension deadline are each
 * dropped when the data behind them is missing.
 */
const message = computed(() => {
  const subject = { invoice: invoiceLabel.value, amount: amountLabel.value };
  if (isSuspended.value) {
    return t(`${KEY_PREFIX}.suspended_summary`, subject);
  }
  const failedOn = formatDay(invoice.value?.failedAt);
  const nextRetryOn = formatDay(invoice.value?.nextRetryAt);
  const suspendOn = formatDay(invoice.value?.suspendAt);
  const sentences = [
    failedOn
      ? t(`${KEY_PREFIX}.summary_with_date`, { ...subject, date: failedOn })
      : t(`${KEY_PREFIX}.summary`, subject),
    nextRetryOn && t(`${KEY_PREFIX}.next_retry`, { date: nextRetryOn }),
    suspendOn && t(`${KEY_PREFIX}.suspend_warning`, { date: suspendOn }),
  ];
  return sentences.filter(Boolean).join(" ");
});

function settle(): void {
  const url = invoice.value?.hostedInvoiceUrl;
  if (!url || typeof window === "undefined") return;
  window.open(url, "_blank", "noopener");
}

onMounted(load);
</script>

<template>
  <DmsSaasLoadFailure
    v-if="error && !data"
    :title="$t('saas.workspace.billing.past_due.load_failed')"
    @retry="refresh"
  />
  <UCard v-else-if="invoice" variant="subtle" class="ring-error/40">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <UIcon name="i-ph-warning-circle" class="text-error size-5" />
        <h3 class="font-semibold">{{ $t(heading.title) }}</h3>
        <UBadge color="warning" variant="subtle">
          {{ $t(heading.badge) }}
        </UBadge>
      </div>
    </template>

    <div class="flex flex-col gap-3">
      <p class="text-muted text-sm">{{ message }}</p>
      <div>
        <UButton
          v-if="invoice.hostedInvoiceUrl"
          color="primary"
          icon="i-ph-arrow-square-out"
          @click="settle"
        >
          {{ $t(`${KEY_PREFIX}.settle`) }}
        </UButton>
      </div>
    </div>
  </UCard>
</template>
