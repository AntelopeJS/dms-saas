<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const FREE_PLAN_PRICE = 0;
const SUMMARY_SEPARATOR = " · ";
const FULL_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const {
  load,
  refresh: refetchPlan,
  error: loadError,
  cancelPendingChange,
} = useTenantPlan();
const { data: billingStatus, load: loadBillingStatus } = useBillingStatus();
const { formatMajorUnits } = useMoneyFormat();
const { t, locale } = useI18n();
const { formatFeatureValue } = usePlanFeatureFormat();
const { workspace, load: loadWorkspace } = useCurrentWorkspace();
const { isOpen: isComparisonOpen } = usePlanComparison();
const planIntervalLabel = usePlanIntervalLabel("saas.workspace.plan.interval");

const data = ref<TenantPlanResponse | null>(null);
const isLoading = ref(true);
const isCancelling = ref(false);
const isUpgradeOpen = ref(false);
const upgradeTarget = ref<TenantPlanView | null>(null);

const current = computed(() => data.value?.current ?? null);
const pendingPlan = computed(() => data.value?.pendingPlan ?? null);
const isPaid = computed(() => (current.value?.price ?? 0) > FREE_PLAN_PRICE);

/** The card is readable on a blocked workspace's billing page, but plan
 * mutations stay gated server-side: settling the invoice comes first. */
const isAccessBlocked = computed(
  () =>
    isBlockingSubscriptionStatus(data.value?.status) &&
    !data.value?.canRecoverComplimentary,
);

/** Plan mutations are owner-only server-side; a member gets the read-only
 * card instead of buttons that can only end in a 403 toast. */
const isTenantOwner = computed(() => !!billingStatus.value?.isTenantOwner);

function formatDay(value: string | null | undefined): string | null {
  return formatDate(value, locale.value, FULL_DATE_FORMAT);
}

const renewalDate = computed(() => formatDay(data.value?.currentPeriodEnd));

const pendingDowngradeLabel = computed(() => {
  const pending = pendingPlan.value;
  if (!pending) return null;
  const date = formatDay(pending.effectiveAt);
  return date
    ? t("saas.workspace.plan.pending_downgrade_on", {
        plan: pending.planName,
        date,
      })
    : t("saas.workspace.plan.pending_downgrade", { plan: pending.planName });
});

/** A workspace still on Free is being asked to convert, not to switch: the
 * button carries the primary weight and different copy. */
const changeAction = computed(() =>
  isPaid.value
    ? { color: "neutral" as const, variant: "subtle" as const, key: "change" }
    : { color: "primary" as const, variant: "solid" as const, key: "go_paid" },
);

/**
 * One line on what the plan includes: the catalogue's own description when it
 * has one, else the plan's key (non-detail) limits.
 */
const summary = computed(() => {
  if (current.value?.description) return current.value.description;
  const view = data.value?.available.find(
    (plan) => plan._id === current.value?._id,
  );
  if (!view || !data.value) return "";
  return data.value.features
    .filter(
      (feature) =>
        !feature.isDetailRow &&
        view.featureValues[feature.featureId] !== undefined,
    )
    .map(
      (feature) =>
        `${feature.displayName} ${formatFeatureValue(feature, view.featureValues[feature.featureId])}`,
    )
    .join(SUMMARY_SEPARATOR);
});

function openUpgrade(plan: TenantPlanView): void {
  upgradeTarget.value = plan;
  isUpgradeOpen.value = true;
}

const priceLabel = computed(() =>
  current.value
    ? formatMajorUnits(current.value.price, current.value.currency)
    : "",
);
const currentIntervalLabel = computed(() =>
  current.value ? planIntervalLabel(current.value.interval) : "",
);

async function fetchPlan(force: boolean): Promise<void> {
  isLoading.value = true;
  try {
    data.value = force ? await refetchPlan() : await load();
  } finally {
    isLoading.value = false;
  }
}

function refresh(): Promise<void> {
  return fetchPlan(true);
}

async function cancelDowngrade(): Promise<void> {
  isCancelling.value = true;
  try {
    await cancelPendingChange();
    toast.add({
      title: t("saas.workspace.plan.downgrade_cancelled"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    await refresh();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.plan.change_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isCancelling.value = false;
  }
}

onMounted(() => {
  void loadBillingStatus();
  void loadWorkspace().catch(() => undefined);
  return fetchPlan(false);
});
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">
          {{ $t("saas.workspace.plan.current") }}
        </h3>
        <UBadge v-if="pendingDowngradeLabel" color="warning" variant="subtle">
          {{ pendingDowngradeLabel }}
        </UBadge>
      </div>
    </template>

    <div v-if="isLoading" class="flex flex-col gap-3">
      <USkeleton class="h-8 w-48" />
      <USkeleton class="h-4 w-full" />
    </div>

    <DmsSaasLoadFailure v-else-if="loadError && !data" @retry="refresh" />

    <div v-else-if="data" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start gap-4">
        <div class="min-w-60 grow">
          <h2 v-if="current" class="text-lg font-semibold">
            {{ current.name }}
          </h2>
          <p v-if="summary" class="text-muted mt-1 text-sm">
            {{ summary }}
          </p>
        </div>
        <div v-if="current" class="text-right">
          <span class="text-2xl font-semibold tabular-nums">
            {{ priceLabel }}
          </span>
          <span v-if="currentIntervalLabel" class="text-muted text-sm">
            /{{ currentIntervalLabel }}
          </span>
        </div>
      </div>

      <div
        v-if="data.isComplimentary && current"
        class="border-default border-t pt-4 text-sm"
      >
        <div class="flex justify-between gap-4">
          <span>{{ $t("saas.admission.complimentary_reduction") }}</span>
          <span class="tabular-nums">−{{ priceLabel }}</span>
        </div>
        <div class="mt-2 flex justify-between gap-4 font-semibold">
          <span>{{ $t("saas.admission.total") }}</span>
          <span class="tabular-nums">
            {{ formatMajorUnits(0, current.currency) }}
          </span>
        </div>
      </div>

      <p
        v-if="renewalDate && isPaid && !data.isComplimentary"
        class="text-muted text-sm"
      >
        {{ $t("saas.workspace.plan.next_renewal", { date: renewalDate }) }}
      </p>

      <p v-if="isAccessBlocked" class="text-muted text-sm">
        {{ $t("saas.workspace.plan.blocked_hint") }}
      </p>

      <p v-else-if="data.isPlanChangeLocked" class="text-muted text-sm">
        {{ $t("saas.admission.plan_managed") }}
      </p>

      <div v-else-if="isTenantOwner" class="flex flex-wrap gap-2">
        <UButton
          v-if="pendingPlan"
          color="neutral"
          variant="subtle"
          icon="i-ph-arrow-u-up-left"
          :loading="isCancelling"
          @click="cancelDowngrade"
        >
          {{ $t("saas.workspace.plan.cancel_downgrade") }}
        </UButton>
        <UButton
          :color="changeAction.color"
          :variant="changeAction.variant"
          icon="i-ph-stack"
          @click="isComparisonOpen = true"
        >
          {{ $t(`saas.workspace.plan.${changeAction.key}`) }}
        </UButton>
      </div>

      <DmsSaasPlanComparisonModal
        v-model:open="isComparisonOpen"
        :plans="data.available"
        :features="data.features"
        :current-plan-id="current?._id ?? null"
        :pending-plan-id="pendingPlan?.planId ?? null"
        :is-recovery="data.canRecoverComplimentary"
        :is-current-paid="isPaid"
        :workspace-name="workspace?.name ?? null"
        @changed="refresh"
        @upgrade="openUpgrade"
      />
      <DmsSaasPlanUpgradeModal
        v-model:open="isUpgradeOpen"
        :plan="upgradeTarget"
        @changed="refresh"
      />
    </div>
  </UCard>
</template>
