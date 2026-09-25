<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  plans: TenantPlanView[];
  features: TenantPlanFeature[];
  /** Consumer i18n prefixes feature labels and tooltips resolve under. */
  featureTranslationPrefixes?: string[];
  currentPlanId: string | null;
  pendingPlanId: string | null;
  isRecovery?: boolean;
  /** A paid plan chosen from a free one goes through the upgrade flow. */
  isCurrentPaid?: boolean;
  workspaceName?: string | null;
}>();

const emit = defineEmits<{ changed: []; upgrade: [plan: TenantPlanView] }>();

const ESCAPE_KEY = "Escape";

const open = defineModel<boolean>("open", { default: false });

const { t } = useI18n();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { changePlan } = useTenantPlan();
const { formatFeatureValue } = usePlanFeatureFormat();
const { featureLabel, featureTooltip, comparisonNote } = usePlanFeatureLabel(
  () => props.featureTranslationPrefixes ?? [],
);
const contactUrl = usePlanContactUrl();
const { formatMajorUnits } = useMoneyFormat();
const planIntervalLabel = usePlanIntervalLabel("saas.workspace.plan.interval");

const showDetailRows = ref(false);
const pendingPlanRequest = ref<string | null>(null);

/** A feature no compared plan sets would only render a row of dashes. */
const comparedFeatures = computed(() =>
  props.features.filter((feature) =>
    props.plans.some(
      (plan) => plan.featureValues[feature.featureId] !== undefined,
    ),
  ),
);

interface FeatureRow {
  feature: TenantPlanFeature;
  label: string;
  tooltip: string | null;
}

const visibleRows = computed<FeatureRow[]>(() =>
  comparedFeatures.value
    .filter((feature) => showDetailRows.value || !feature.isDetailRow)
    .map((feature) => ({
      feature,
      label: featureLabel(feature),
      tooltip: featureTooltip(feature),
    })),
);

const note = computed(() => comparisonNote());

const hasDetailRows = computed(() =>
  comparedFeatures.value.some((feature) => feature.isDetailRow),
);

// The DMS shell keeps its own keyboard shortcuts, which can swallow Escape
// before the dialog sees it; closing on it here makes the modal dismissable
// wherever focus sits.
function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === ESCAPE_KEY) open.value = false;
}

watch(open, (isOpen) => {
  if (typeof window === "undefined") return;
  if (isOpen) window.addEventListener("keydown", closeOnEscape);
  else window.removeEventListener("keydown", closeOnEscape);
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined")
    window.removeEventListener("keydown", closeOnEscape);
});

const currentPlan = computed(
  () => props.plans.find((plan) => plan._id === props.currentPlanId) ?? null,
);

function priceLabel(plan: TenantPlanView): string {
  return formatMajorUnits(plan.price, plan.currency);
}

function isCurrent(plan: TenantPlanView): boolean {
  return plan._id === props.currentPlanId;
}

/** The paid plans are the way forward from a free one or a recovery. */
function isHighlighted(plan: TenantPlanView): boolean {
  const isWayForward = props.isRecovery || !props.isCurrentPaid;
  return isWayForward && plan.checkoutAvailable;
}

function needsUpgradeFlow(plan: TenantPlanView): boolean {
  return !props.isCurrentPaid && plan.price > 0;
}

async function select(plan: TenantPlanView): Promise<void> {
  if (needsUpgradeFlow(plan)) {
    open.value = false;
    emit("upgrade", plan);
    return;
  }
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
            workspace: workspaceName ?? '',
            plan: currentPlan.name,
          })
        : $t('saas.workspace.plan.comparison.subtitle_no_plan')
    "
    :ui="{ content: 'max-w-5xl' }"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="overflow-x-auto">
          <table class="min-w-3xl w-full border-collapse text-sm">
            <thead>
              <tr>
                <th class="w-56" />
                <th
                  v-for="plan in plans"
                  :key="plan._id"
                  scope="col"
                  class="border-default border-b p-3 text-center align-top"
                  :class="isCurrent(plan) ? 'bg-primary/10 rounded-t-lg' : ''"
                >
                  <div class="flex flex-col items-center gap-2">
                    <span class="font-semibold">{{ plan.name }}</span>
                    <span
                      v-if="plan.isContactOnly"
                      class="text-primary font-semibold"
                    >
                      {{ $t("saas.workspace.plan.comparison.on_quote") }}
                    </span>
                    <span v-else class="text-primary font-semibold tabular-nums">
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
                    <!-- Sold on quote: the contact link replaces "Choose". -->
                    <template v-else-if="plan.isContactOnly">
                      <UButton
                        v-if="contactUrl"
                        size="xs"
                        color="neutral"
                        variant="subtle"
                        icon="i-ph-envelope-simple"
                        :to="contactUrl"
                        target="_blank"
                        external
                      >
                        {{ $t("saas.workspace.plan.comparison.contact") }}
                      </UButton>
                    </template>
                    <UButton
                      v-else
                      size="xs"
                      :color="isHighlighted(plan) ? 'primary' : 'neutral'"
                      :variant="isHighlighted(plan) ? 'solid' : 'subtle'"
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
                v-for="{ feature, label, tooltip } in visibleRows"
                :key="feature.featureId"
                class="border-default border-b last:border-0"
              >
                <th scope="row" class="p-3 text-left font-normal">
                  <span class="inline-flex items-center gap-1">
                    {{ label }}
                    <UTooltip v-if="tooltip" :text="tooltip">
                      <UButton
                        variant="link"
                        color="neutral"
                        size="xs"
                        icon="i-ph-info"
                        :aria-label="tooltip"
                        class="text-muted p-0"
                      />
                    </UTooltip>
                  </span>
                </th>
                <td
                  v-for="plan in plans"
                  :key="plan._id"
                  class="p-3 text-center tabular-nums"
                  :class="isCurrent(plan) ? 'bg-primary/10' : ''"
                >
                  {{
                    formatFeatureValue(
                      feature,
                      plan.featureValues[feature.featureId],
                      plan.currency,
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
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-4">
        <p v-if="note" class="text-muted grow text-sm">
          {{ note }}
        </p>
        <UButton color="neutral" variant="subtle" @click="open = false">
          {{ $t("saas.workspace.plan.comparison.close") }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
