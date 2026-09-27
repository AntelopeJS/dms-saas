<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  plan: TenantPlanView | null;
}>();

const emit = defineEmits<{ changed: [] }>();

const open = defineModel<boolean>("open", { default: false });

const KEY_PREFIX = "saas.workspace.plan.upgrade";

const toast = useToast();
const { t } = useI18n();
const { resolveApiError } = useApiErrorMessage();
const identity = useBillingIdentity();
const { changePlan } = useTenantPlan();
const { formatMajorUnits } = useMoneyFormat();
const planIntervalLabel = usePlanIntervalLabel("saas.workspace.plan.interval");

const draft = ref<BillingIdentityDraft>(emptyBillingIdentityDraft());
const hasTriedSubmit = ref(false);
// Flagged once a submit was attempted, then re-checked as the user types so
// a corrected field clears its error right away.
const invalidFields = computed<BillingIdentityField[]>(() =>
  hasTriedSubmit.value ? findMissingBillingFields(draft.value) : [],
);
const isLoading = ref(false);
const loadFailed = ref(false);
const isSubmitting = ref(false);

const priceLabel = computed(() =>
  props.plan ? formatMajorUnits(props.plan.price, props.plan.currency) : "",
);
const intervalLabel = computed(() =>
  props.plan ? planIntervalLabel(props.plan.interval) : "",
);

async function loadIdentity(): Promise<void> {
  isLoading.value = true;
  loadFailed.value = false;
  hasTriedSubmit.value = false;
  try {
    draft.value = toBillingIdentityDraft(await identity.load());
  } catch {
    loadFailed.value = true;
  } finally {
    isLoading.value = false;
  }
}

watch(open, (isOpen) => {
  if (isOpen) void loadIdentity();
});

function notifyError(title: string): void {
  toast.add({ title, color: "error", icon: "i-ph-warning-circle" });
}

/**
 * The identity is saved first: the plan change checks the plan's audience
 * against the stored customer type, and Stripe Checkout bills the customer
 * this identity describes. The card itself is collected by Stripe.
 */
async function confirm(): Promise<void> {
  const plan = props.plan;
  if (!plan) return;
  hasTriedSubmit.value = true;
  if (invalidFields.value.length > 0) {
    notifyError(t("saas.workspace.billing.identity.incomplete_toast"));
    return;
  }
  isSubmitting.value = true;
  try {
    await identity.save(draft.value);
    const result = await changePlan(plan._id);
    if (result.checkoutUrl && typeof window !== "undefined") {
      window.location.href = result.checkoutUrl;
      return;
    }
    toast.add({
      title: t("saas.workspace.plan.change_applied"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    open.value = false;
    emit("changed");
  } catch (error) {
    notifyError(resolveApiError(error, "saas.workspace.plan.change_error"));
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t(`${KEY_PREFIX}.title`, { plan: plan?.name ?? '' })"
    :description="$t(`${KEY_PREFIX}.description`)"
    :ui="{ content: 'max-w-2xl' }"
  >
    <template #body>
      <div v-if="isLoading" class="flex flex-col gap-3">
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
      </div>

      <DmsSaasLoadFailure v-else-if="loadFailed" @retry="loadIdentity" />

      <form
        v-else-if="plan"
        id="saas-plan-upgrade-form"
        class="flex flex-col gap-6"
        novalidate
        @submit.prevent="confirm"
      >
        <div class="border-default rounded-lg border p-4 text-sm">
          <div class="flex justify-between gap-4">
            <span>
              {{ $t(`${KEY_PREFIX}.subscription`, { plan: plan.name }) }}
            </span>
            <span class="tabular-nums">
              {{ priceLabel }}/{{ intervalLabel }}
            </span>
          </div>
          <div
            class="border-default mt-3 flex justify-between gap-4 border-t pt-3 font-semibold"
          >
            <span>{{ $t(`${KEY_PREFIX}.due_today`) }}</span>
            <span class="text-primary tabular-nums">
              {{ $t(`${KEY_PREFIX}.excl_tax`, { amount: priceLabel }) }}
            </span>
          </div>
          <p class="text-muted mt-2 text-xs">
            {{ $t(`${KEY_PREFIX}.tax_note`) }}
          </p>
        </div>

        <section class="flex flex-col gap-3">
          <h4 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-ph-identification-card" class="size-5" />
            {{ $t("saas.workspace.billing.info_title") }}
          </h4>
          <DmsSaasBillingIdentityFields
            v-model="draft"
            :invalid-fields="invalidFields"
          />
        </section>

        <section class="flex flex-col gap-2">
          <h4 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-ph-credit-card" class="size-5" />
            {{ $t(`${KEY_PREFIX}.card_title`) }}
          </h4>
          <p class="text-muted text-sm">{{ $t(`${KEY_PREFIX}.card_note`) }}</p>
        </section>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="subtle" @click="open = false">
          {{ $t("common.cancel") }}
        </UButton>
        <UButton
          type="submit"
          form="saas-plan-upgrade-form"
          color="primary"
          icon="i-ph-lock-simple"
          :loading="isSubmitting"
          :disabled="isLoading || loadFailed"
        >
          {{ $t(`${KEY_PREFIX}.confirm`) }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
