<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  plans: TenantPlanView[];
  features: TenantPlanFeature[];
  currentPlanId: string | null;
  pendingPlanId: string | null;
  isRecovery?: boolean;
}>();

const emit = defineEmits<{ changed: [] }>();

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { changePlan } = useTenantPlan();
const { formatFeatureValue } = usePlanFeatureFormat();
const { formatMajorUnits } = useMoneyFormat();
const planIntervalLabel = usePlanIntervalLabel("saas.workspace.plan.interval");

const showDetailRows = ref(false);
const pendingPlanRequest = ref<string | null>(null);

const visibleFeatures = computed(() =>
  props.features.filter(
    (feature) => showDetailRows.value || !feature.isDetailRow,
  ),
);

const hasDetailRows = computed(() =>
  props.features.some((feature) => feature.isDetailRow),
);

const currentPlan = computed(
  () => props.plans.find((plan) => plan._id === props.currentPlanId) ?? null,
);

function priceLabel(plan: TenantPlanView): string {
  return formatMajorUnits(plan.price, plan.currency);
}

function isCurrent(plan: TenantPlanView): boolean {
  return plan._id === props.currentPlanId;
}

async function select(plan: TenantPlanView): Promise<void> {
  pendingPlanRequest.value = plan._id;
  try {
    const result = await changePlan(plan._id);
    if (result.checkoutUrl && typeof window !== "undefined") {
      window.location.href = result.checkoutUrl;
      return;
    }
    toast.add({
      title: result.scheduled
        ? t("saas.workspace.plan.change_scheduled")
        : t("saas.workspace.plan.change_applied"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    open.value = false;
    emit("changed");
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.plan.change_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    pendingPlanRequest.value = null;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('saas.workspace.plan.comparison.title')"
    :description="
      currentPlan
        ? $t('saas.workspace.plan.comparison.subtitle', {
            plan: currentPlan.name,
          })
        : $t('saas.workspace.plan.comparison.subtitle_no_plan')
    "
    :ui="{ content: 'max-w-5xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="overflow-x-auto">
          <table class="w-full min-w-3xl border-collapse text-sm">
            <thead>
              <tr>
                <th class="w-56" />
                <th
                  v-for="plan in plans"
                  :key="plan._id"
                  scope="col"
                  class="border-default border-b p-3 text-center align-top"
                  :class="isCurrent(plan) ? 'bg-elevated/50' : ''"
                >
                  <div class="flex flex-col items-center gap-2">
                    <span class="font-semibold">{{ plan.name }}</span>
                    <span class="text-muted tabular-nums">
                      {{ priceLabel(plan) }}
                      <span class="text-xs">
                        /{{ planIntervalLabel(plan.interval) }}
                      </span>
                    </span>
                    <UBadge
                      v-if="isCurrent(plan) && !isRecovery"
                      color="primary"
                      variant="subtle"
                    >
                      {{ $t("saas.workspace.plan.comparison.current") }}
                    </UBadge>
                    <UBadge
                      v-else-if="plan._id === pendingPlanId"
                      color="warning"
                      variant="subtle"
                    >
                      {{ $t("saas.workspace.plan.comparison.scheduled") }}
                    </UBadge>
                    <UButton
                      v-else
                      size="xs"
                      :color="
                        isRecovery && plan.checkoutAvailable
                          ? 'primary'
                          : 'neutral'
                      "
                      :variant="
                        isRecovery && plan.checkoutAvailable
                          ? 'solid'
                          : 'subtle'
                      "
                      :loading="pendingPlanRequest === plan._id"
                      :disabled="
                        pendingPlanRequest !== null ||
                        (isRecovery && !plan.checkoutAvailable)
                      "
                      @click="select(plan)"
                    >
                      {{ $t("saas.workspace.plan.comparison.choose") }}
                    </UButton>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="feature in visibleFeatures"
                :key="feature.featureId"
                class="border-default border-b last:border-0"
              >
                <th scope="row" class="p-3 text-left font-normal">
                  <span class="inline-flex items-center gap-1">
                    {{ feature.displayName }}
                    <UTooltip v-if="feature.tooltip" :text="feature.tooltip">
                      <UButton
                        variant="link"
                        color="neutral"
                        size="xs"
                        icon="i-ph-info"
                        :aria-label="feature.tooltip"
                        class="text-muted p-0"
                      />
                    </UTooltip>
                  </span>
                </th>
                <td
                  v-for="plan in plans"
                  :key="plan._id"
                  class="p-3 text-center tabular-nums"
                  :class="isCurrent(plan) ? 'bg-elevated/50' : ''"
                >
                  {{
                    formatFeatureValue(
                      feature,
                      plan.featureValues[feature.featureId],
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="hasDetailRows" class="flex justify-center">
          <UButton
            variant="link"
            color="primary"
            :icon="showDetailRows ? 'i-ph-caret-up' : 'i-ph-caret-down'"
            @click="showDetailRows = !showDetailRows"
          >
            {{
              showDetailRows
                ? $t("saas.workspace.plan.comparison.hide_detail")
                : $t("saas.workspace.plan.comparison.show_detail")
            }}
          </UButton>
        </div>

        <p class="text-muted text-xs">
          {{ $t("saas.workspace.plan.comparison.footer") }}
        </p>
      </div>
    </template>
  </UModal>
</template>
