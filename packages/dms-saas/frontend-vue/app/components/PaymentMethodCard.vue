<script setup lang="ts">
import { computed, onMounted } from "vue";

const PAST_DUE_STATUS = "past_due";
const EXPIRY_YEAR_MODULO = 100;
const EXPIRY_PAD_LENGTH = 2;

const { data, error, load, refresh } = useBillingStatus();

const card = computed(() => data.value?.paymentMethod ?? null);
const needsUpdate = computed(() => data.value?.status === PAST_DUE_STATUS);
// Card details are owner-only in the API payload; showing the block to a
// member would falsely read as "no card on file".
const isVisible = computed(
  () => !!data.value?.hasStripeCustomer && !!data.value?.isTenantOwner,
);

const headerBadge = computed(() => {
  if (!card.value) return { color: "warning" as const, key: "missing" };
  if (needsUpdate.value) return { color: "warning" as const, key: "needs_update" };
  return { color: "success" as const, key: "active" };
});

const cardBadge = computed(() =>
  needsUpdate.value
    ? { color: "warning" as const, key: "declined" }
    : { color: "neutral" as const, key: "default" },
);

const expiryLabel = computed(() => {
  if (!card.value) return "";
  const month = String(card.value.expMonth).padStart(EXPIRY_PAD_LENGTH, "0");
  const year = String(card.value.expYear % EXPIRY_YEAR_MODULO).padStart(
    EXPIRY_PAD_LENGTH,
    "0",
  );
  return `${month}/${year}`;
});

onMounted(load);
</script>

<template>
  <DmsSaasLoadFailure v-if="error && !data" @retry="refresh" />
  <UCard v-else-if="isVisible">
    <template #header>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">
          {{ $t("saas.workspace.billing.payment_method.title") }}
        </h3>
        <UBadge :color="headerBadge.color" variant="subtle">
          {{ $t(`saas.workspace.billing.payment_method.${headerBadge.key}`) }}
        </UBadge>
      </div>
    </template>

    <div class="flex flex-col gap-4">
      <div
        v-if="card"
        class="border-default flex flex-wrap items-center gap-3 rounded-lg border p-3"
      >
        <UIcon name="i-ph-credit-card" class="text-muted size-5" />
        <span class="font-medium capitalize">
          {{ card.brand }} •••• {{ card.last4 }}
        </span>
        <span class="text-muted text-sm">
          {{ $t("saas.workspace.billing.payment_method.expires", { date: expiryLabel }) }}
        </span>
        <span class="grow" />
        <UBadge :color="cardBadge.color" variant="subtle">
          {{ $t(`saas.workspace.billing.payment_method.${cardBadge.key}`) }}
        </UBadge>
      </div>
      <p v-else class="text-muted text-sm">
        {{ $t("saas.workspace.billing.payment_method.none") }}
      </p>

      <div class="border-default flex flex-wrap items-center gap-3 border-t pt-4">
        <DmsSaasCustomerPortalButton />
        <p class="text-muted grow text-xs">
          {{ $t("saas.workspace.billing.payment_method.portal_hint") }}
        </p>
      </div>
    </div>
  </UCard>
</template>
