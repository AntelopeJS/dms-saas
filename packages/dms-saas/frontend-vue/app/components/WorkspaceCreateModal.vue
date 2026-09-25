<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface PlanOption {
  _id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
}

interface FreePlanAvailability {
  isAvailable: boolean;
  blockingWorkspaceName: string | null;
}

interface CreateOptions {
  freePlan: FreePlanAvailability;
}

const props = defineProps<{
  onSuccessCallback?: (tenantId: string) => void;
  onCancelCallback?: () => void;
}>();

const PLANS_ENDPOINT = "/api/saas/plans/public";
const OPTIONS_ENDPOINT = "/api/saas/workspaces/create-options";
const SETUP_INTENT_ENDPOINT = "/api/saas/workspaces/setup-intent";
const CREATE_ENDPOINT = "/api/saas/workspaces";
const PAYMENT_ELEMENT_ID = "dms-saas-workspace-create-payment-element";
const FREE_PLAN_PRICE = 0;

const { $authFetch } = useAuthFetch();
const { t, locale } = useI18n();
const { resolveApiError } = useApiErrorMessage();
const planIntervalLabel = usePlanIntervalLabel(
  "saas.workspaces.create.self_serve.interval",
);
const config = useDmsRuntimeConfig();

const stripePublishableKey = computed<string>(
  () => (config.public.dmsSaas as any)?.stripePublishableKey ?? "",
);

const workspaceName = ref("");
const plans = ref<PlanOption[]>([]);
const selectedPlanId = ref<string | null>(null);
const freePlan = ref<FreePlanAvailability>({
  isAvailable: true,
  blockingWorkspaceName: null,
});
const isLoading = ref(true);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);
const nameError = ref<string | null>(null);
const cardError = ref<string | null>(null);
const stripeHandle = ref<ReturnType<typeof useStripePaymentElement> | null>(
  null,
);

function isFreePlan(plan: PlanOption): boolean {
  return plan.price <= FREE_PLAN_PRICE;
}

function isPlanDisabled(plan: PlanOption): boolean {
  return isFreePlan(plan) && !freePlan.value.isAvailable;
}

function formatPrice(plan: PlanOption): string {
  return new Intl.NumberFormat(locale.value, {
    style: "currency",
    currency: plan.currency.toUpperCase(),
  }).format(plan.price);
}

function planPriceLabel(plan: PlanOption): string {
  // A free plan has no billing cycle to mention, so it stops at the amount.
  if (isFreePlan(plan)) return formatPrice(plan);
  return t("saas.workspaces.create.self_serve.price", {
    price: formatPrice(plan),
    interval: planIntervalLabel(plan.interval),
  });
}

function planHint(plan: PlanOption): string {
  if (!isPlanDisabled(plan)) return plan.description;
  const workspace = freePlan.value.blockingWorkspaceName;
  if (!workspace) {
    return t("saas.workspaces.create.self_serve.free_unavailable");
  }
  return t("saas.workspaces.create.self_serve.free_taken", { workspace });
}

const selectablePlans = computed(() =>
  plans.value.filter((plan) => !isPlanDisabled(plan)),
);

// Only once the catalogue actually loaded: a failed load reports itself.
const hasNoPlanOnOffer = computed(
  () => !isLoading.value && !errorMessage.value && plans.value.length === 0,
);

function selectPlan(plan: PlanOption): void {
  if (isPlanDisabled(plan)) return;
  selectedPlanId.value = plan._id;
}

async function initStripeElement(): Promise<void> {
  if (!stripePublishableKey.value) {
    // A missing key otherwise renders an empty card box and fails every
    // submit with a generic payment error, reading as the user's fault.
    cardError.value = t("saas.workspaces.create.self_serve.error.card");
    return;
  }
  const setup = await $authFetch<{ clientSecret: string }>(
    SETUP_INTENT_ENDPOINT,
  );
  stripeHandle.value = useStripePaymentElement({
    publishableKey: stripePublishableKey.value,
    clientSecret: setup.clientSecret,
    containerId: PAYMENT_ELEMENT_ID,
  });
}

async function load(): Promise<void> {
  try {
    const [loadedPlans, options] = await Promise.all([
      $authFetch<PlanOption[]>(PLANS_ENDPOINT),
      $authFetch<CreateOptions>(OPTIONS_ENDPOINT),
    ]);
    plans.value = loadedPlans;
    freePlan.value = options.freePlan;
    selectedPlanId.value = selectablePlans.value[0]?._id ?? null;
    // Nothing to pay for, so no card to set up.
    if (loadedPlans.length === 0) return;
  } catch (error) {
    errorMessage.value = resolveApiError(
      error,
      "saas.workspaces.create.self_serve.error.load",
    );
    return;
  } finally {
    isLoading.value = false;
  }
  // Kept out of the block above so a card-setup outage reports itself as such
  // instead of hiding behind "could not load the creation options".
  try {
    await initStripeElement();
  } catch (error) {
    cardError.value = resolveApiError(
      error,
      "saas.workspaces.create.self_serve.error.card",
    );
  }
}

function validate(): boolean {
  nameError.value = workspaceName.value.trim()
    ? null
    : t("saas.workspaces.create.error.name");
  if (nameError.value) return false;
  if (!selectedPlanId.value) {
    errorMessage.value = t("saas.workspaces.create.error.plan");
    return false;
  }
  if (!stripeHandle.value) {
    errorMessage.value = t("saas.register.error.no_payment");
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  if (isSubmitting.value || !validate()) return;
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    const confirmed = await stripeHandle.value?.confirmAndGetPaymentMethod();
    if (!confirmed?.paymentMethodId) {
      errorMessage.value =
        confirmed?.error?.message ?? t("saas.register.error.no_payment");
      return;
    }
    const created = await $authFetch<{ tenantId: string }>(CREATE_ENDPOINT, {
      method: "POST",
      body: {
        workspaceName: workspaceName.value.trim(),
        planId: selectedPlanId.value,
        paymentMethodId: confirmed.paymentMethodId,
      },
    });
    props.onSuccessCallback?.(created.tenantId);
  } catch (error) {
    errorMessage.value = resolveApiError(
      error,
      "saas.workspaces.create.self_serve.error.failed",
    );
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-3">
    <USkeleton class="h-10 w-full" />
    <USkeleton class="h-24 w-full" />
  </div>
  <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
    <UFormField
      :label="$t('saas.workspaces.create.field.name')"
      :error="nameError ?? false"
    >
      <UInput
        v-model="workspaceName"
        :placeholder="$t('saas.workspaces.create.placeholder.name')"
        class="w-full"
        autofocus
        @update:model-value="nameError = null"
      />
    </UFormField>

    <UAlert
      v-if="hasNoPlanOnOffer"
      color="neutral"
      variant="subtle"
      icon="i-ph-info"
      :description="$t('saas.workspaces.create.self_serve.no_plans')"
    />

    <div v-else class="flex flex-col gap-2">
      <span class="text-sm font-medium">
        {{ $t("saas.workspaces.create.field.plan") }}
        <span class="text-muted font-normal">
          {{ $t("saas.workspaces.create.self_serve.plan_hint") }}
        </span>
      </span>
      <button
        v-for="plan in plans"
        :key="plan._id"
        type="button"
        class="border-default flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors"
        :class="[
          selectedPlanId === plan._id ? 'border-primary bg-primary/5' : '',
          isPlanDisabled(plan)
            ? 'cursor-not-allowed opacity-60'
            : 'hover:border-accented cursor-pointer',
        ]"
        :disabled="isPlanDisabled(plan)"
        :aria-pressed="selectedPlanId === plan._id"
        @click="selectPlan(plan)"
      >
        <span class="text-highlighted text-sm font-medium">
          {{ plan.name }} — {{ planPriceLabel(plan) }}
        </span>
        <span class="text-muted text-xs">{{ planHint(plan) }}</span>
      </button>
    </div>

    <UFormField
      v-if="!hasNoPlanOnOffer"
      :label="$t('saas.workspaces.create.self_serve.card')"
    >
      <div :id="PAYMENT_ELEMENT_ID" class="border-default rounded-md border p-4" />
      <p v-if="cardError" class="text-error mt-1 text-sm">{{ cardError }}</p>
    </UFormField>

    <p v-if="errorMessage" class="text-error text-sm">{{ errorMessage }}</p>

    <div class="flex justify-end gap-2">
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="isSubmitting"
        @click="props.onCancelCallback?.()"
      >
        {{ $t("common.cancel") }}
      </UButton>
      <UButton
        type="submit"
        color="primary"
        :loading="isSubmitting"
        :disabled="hasNoPlanOnOffer"
      >
        {{ $t("saas.workspaces.create.self_serve.submit") }}
      </UButton>
    </div>
  </form>
</template>
