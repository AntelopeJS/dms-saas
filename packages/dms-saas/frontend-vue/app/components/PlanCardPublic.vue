<script setup lang="ts">
import { computed } from "vue";

interface PlanProp {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  trialDays: number;
  borderColor: string | null;
  borderLabel: string | null;
}

const props = defineProps<{ plan: PlanProp; selected?: boolean }>();
const emit = defineEmits<{ select: [planId: string] }>();
const planIntervalLabel = usePlanIntervalLabel("saas.plans.cycle");

const formattedPrice = computed(() => {
  const price = `${props.plan.price.toFixed(2)} ${props.plan.currency.toUpperCase()}`;
  return `${price}/${planIntervalLabel(props.plan.interval)}`;
});

const borderStyle = computed(() => {
  if (!props.plan.borderColor) return undefined;
  return { borderColor: props.plan.borderColor, borderWidth: "2px" };
});
</script>

<template>
  <UCard
    class="border rounded-lg transition-colors"
    :class="selected ? 'border-primary border-2' : 'border-default'"
    :style="borderStyle"
  >
    <template v-if="plan.borderLabel" #header>
      <div
        class="text-center text-white font-semibold py-1"
        :style="{ background: plan.borderColor ?? undefined }"
      >
        {{ plan.borderLabel }}
      </div>
    </template>
    <div class="flex flex-col gap-2 p-4">
      <h3 class="text-lg font-semibold">{{ plan.name }}</h3>
      <p class="text-muted text-sm">{{ plan.description }}</p>
      <div class="text-2xl font-semibold tabular-nums">{{ formattedPrice }}</div>
      <div v-if="plan.trialDays > 0" class="text-success text-sm">
        {{ $t("saas.plans.trial_days", { days: plan.trialDays }) }}
      </div>
    </div>
    <template #footer>
      <UButton block color="primary" @click="emit('select', plan._id)">
        {{ $t("saas.plans.choose") }}
      </UButton>
    </template>
  </UCard>
</template>
