<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface Props {
  routeParams?: Record<string, string>;
}

interface EligibleUpgradePlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: string;
  maxMembers: number;
}

interface OperatorOptions {
  currentPlanId: string | null;
  currentPlanName: string | null;
  currency: string | null;
  customerBalanceCents: number | null;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  eligibleUpgradePlans: EligibleUpgradePlan[];
}

const props = defineProps<Props>();
const { $authFetch } = useAuthFetch();
const { t } = useDmsApp().$i18n;
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const tenantId = computed(() => props.routeParams?.id ?? "");
const { trigger, triggerRef } = useDetailRefresh(tenantId.value);

const options = ref<OperatorOptions | null>(null);
const isLoading = ref(true);
const isSubmitting = ref(false);
const isUpgradeOpen = ref(false);
const isCreditOpen = ref(false);
const selectedPlanId = ref<string | undefined>();
const creditAmountCents = ref<number | undefined>();
const creditReason = ref("");
const upgradeOperationId = ref(crypto.randomUUID());
const creditOperationId = ref(crypto.randomUUID());

const planItems = computed(() =>
  (options.value?.eligibleUpgradePlans ?? []).map((plan) => ({
    value: plan.id,
    label: `${plan.name} · ${formatPlanPrice(plan)}`,
  })),
);

const selectedPlan = computed(() =>
  options.value?.eligibleUpgradePlans.find(
    (plan) => plan.id === selectedPlanId.value,
  ),
);

const availableCredit = computed(() => {
  const balance = options.value?.customerBalanceCents;
  return balance === null || balance === undefined
    ? null
    : Math.max(0, -balance);
});

function formatPlanPrice(plan: EligibleUpgradePlan): string {
  return `${formatCents(plan.price * 100, plan.currency)}/${t(
    `saas.plans.cycle.${plan.interval}`,
  )}`;
}

function formatCents(amountCents: number, currency?: string | null): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency ?? "EUR",
  }).format(amountCents / 100);
}

async function loadOptions(): Promise<void> {
  if (!tenantId.value) return;
  isLoading.value = true;
  try {
    options.value = await $authFetch<OperatorOptions>(
      `/api/saas/workspaces/${tenantId.value}/operator-options`,
    );
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.operator.error.load"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isLoading.value = false;
  }
}

function openUpgrade(): void {
  selectedPlanId.value = options.value?.eligibleUpgradePlans[0]?.id;
  upgradeOperationId.value = crypto.randomUUID();
  isUpgradeOpen.value = true;
}

function openCredit(): void {
  creditAmountCents.value = undefined;
  creditReason.value = "";
  creditOperationId.value = crypto.randomUUID();
  isCreditOpen.value = true;
}

async function submitUpgrade(): Promise<void> {
  if (!selectedPlan.value) return;
  const succeeded = await submitAction(
    "upgrade",
    {
      operationId: upgradeOperationId.value,
      planId: selectedPlan.value.id,
    },
    "saas.workspaces.operator.upgrade.success",
  );
  if (succeeded) isUpgradeOpen.value = false;
}

async function submitCredit(): Promise<void> {
  if (!creditAmountCents.value || !creditReason.value.trim()) return;
  const succeeded = await submitAction(
    "balance-credit",
    {
      operationId: creditOperationId.value,
      amountCents: creditAmountCents.value,
      reason: creditReason.value.trim(),
    },
    "saas.workspaces.operator.credit.success",
  );
  if (succeeded) isCreditOpen.value = false;
}

async function submitAction(
  path: string,
  body: Record<string, unknown>,
  successKey: string,
): Promise<boolean> {
  isSubmitting.value = true;
  try {
    await $authFetch(`/api/saas/workspaces/${tenantId.value}/${path}`, {
      method: "POST",
      body,
    });
    toast.add({
      title: t(successKey),
      color: "success",
      icon: "i-ph-check-circle",
    });
    trigger();
    return true;
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.operator.error.action"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    trigger();
    return false;
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(loadOptions);
watch(triggerRef, loadOptions);
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h3 class="font-semibold">
          {{ $t("saas.workspaces.operator.title") }}
        </h3>
        <p class="text-muted mt-1 text-sm">
          {{ $t("saas.workspaces.operator.description") }}
        </p>
      </div>
    </template>

    <div v-if="isLoading" class="flex justify-center py-5">
      <UIcon name="i-ph-circle-notch" class="size-5 animate-spin" />
    </div>

    <div v-else-if="options" class="space-y-5">
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        <UButton
          block
          icon="i-ph-arrow-circle-up"
          :disabled="!options.eligibleUpgradePlans.length"
          @click="openUpgrade"
        >
          {{ $t("saas.workspaces.operator.upgrade.button") }}
        </UButton>
        <UButton
          block
          color="neutral"
          variant="soft"
          icon="i-ph-coins"
          :disabled="!options.hasStripeCustomer"
          @click="openCredit"
        >
          {{ $t("saas.workspaces.operator.credit.button") }}
        </UButton>
      </div>

      <p v-if="!options.eligibleUpgradePlans.length" class="text-muted text-sm">
        {{ $t("saas.workspaces.operator.upgrade.unavailable") }}
      </p>

      <p v-if="!options.hasStripeCustomer" class="text-muted text-sm">
        {{ $t("saas.workspaces.operator.credit.unavailable") }}
      </p>

      <p v-if="availableCredit !== null" class="text-muted text-sm">
        {{
          $t("saas.workspaces.operator.credit.available", {
            amount: formatCents(availableCredit, options.currency),
          })
        }}
      </p>
    </div>

    <UModal
      :open="isUpgradeOpen"
      :title="$t('saas.workspaces.operator.upgrade.title')"
      @update:open="isUpgradeOpen = $event"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitUpgrade">
          <UFormField
            name="planId"
            :label="$t('saas.workspaces.operator.upgrade.plan_label')"
          >
            <USelect
              v-model="selectedPlanId"
              name="upgrade-plan"
              :items="planItems"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="selectedPlan"
            color="warning"
            variant="subtle"
            icon="i-ph-warning"
            :title="$t('saas.workspaces.operator.confirm.title')"
            :description="
              $t('saas.workspaces.operator.upgrade.confirm', {
                current: options?.currentPlanName,
                target: selectedPlan.name,
                price: formatPlanPrice(selectedPlan),
              })
            "
          />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" @click="isUpgradeOpen = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton
            :loading="isSubmitting"
            :disabled="!selectedPlan"
            @click="submitUpgrade"
          >
            {{ $t("saas.workspaces.operator.confirm.submit") }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="isCreditOpen"
      :title="$t('saas.workspaces.operator.credit.title')"
      @update:open="isCreditOpen = $event"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="submitCredit">
          <UFormField
            name="amountCents"
            :label="$t('saas.workspaces.operator.credit.amount_label')"
          >
            <UInput
              v-model.number="creditAmountCents"
              name="credit-amount-cents"
              type="number"
              min="1"
              step="1"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="reason"
            :label="$t('saas.workspaces.operator.credit.reason_label')"
          >
            <UTextarea
              v-model="creditReason"
              name="credit-reason"
              :maxlength="500"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="creditAmountCents && creditReason.trim()"
            color="warning"
            variant="subtle"
            icon="i-ph-warning"
            :title="$t('saas.workspaces.operator.confirm.title')"
            :description="
              $t('saas.workspaces.operator.credit.confirm', {
                amount: formatCents(creditAmountCents, options?.currency),
                reason: creditReason.trim(),
              })
            "
          />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton variant="ghost" @click="isCreditOpen = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton
            :loading="isSubmitting"
            :disabled="!creditAmountCents || !creditReason.trim()"
            @click="submitCredit"
          >
            {{ $t("saas.workspaces.operator.confirm.submit") }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
