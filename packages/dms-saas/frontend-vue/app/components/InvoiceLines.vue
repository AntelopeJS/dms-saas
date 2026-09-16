<script setup lang="ts">
import { computed } from "vue";

const LINE_PERIOD_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

const props = defineProps<{
  modelValue?: InvoiceLine[] | string | null;
  initialValue?: InvoiceLine[] | string | null;
}>();

const { formatMinorUnits } = useMoneyFormat();
const { locale } = useI18n();

const lines = computed(() =>
  parseInvoiceLines(props.modelValue ?? props.initialValue),
);

function formatPeriod(line: InvoiceLine): string | null {
  const start = formatDate(line.periodStart, locale.value, LINE_PERIOD_FORMAT);
  if (!start) return null;
  const end = formatDate(line.periodEnd, locale.value, LINE_PERIOD_FORMAT);
  return end ? `${start} → ${end}` : start;
}
</script>

<template>
  <div
    v-if="lines.length"
    class="border-default divide-default divide-y rounded-lg border"
  >
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="flex flex-wrap items-baseline gap-2 p-3 text-sm"
    >
      <div class="min-w-40 grow">
        <p>{{ line.description || "—" }}</p>
        <p v-if="formatPeriod(line)" class="text-muted text-xs">
          {{ formatPeriod(line) }}
        </p>
      </div>
      <span v-if="line.quantity && line.quantity > 1" class="text-muted text-xs">
        × {{ line.quantity }}
      </span>
      <span class="tabular-nums">
        {{ formatMinorUnits(line.amount, line.currency ?? null) }}
      </span>
    </div>
  </div>
  <p v-else class="text-muted text-sm">
    {{ $t("saas.invoices.lines.empty") }}
  </p>
</template>
