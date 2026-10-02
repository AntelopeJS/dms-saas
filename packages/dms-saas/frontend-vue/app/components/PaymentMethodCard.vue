<script setup lang="ts">
import { computed, onMounted } from "vue";

type BadgeColor = "success" | "warning" | "neutral";

interface PaymentMethodBadge {
  color: BadgeColor;
  key: string;
}

const PAST_DUE_STATUS = "past_due";
const FREE_PLAN_PRICE = 0;
const EXPIRY_YEAR_MODULO = 100;
const EXPIRY_PAD_LENGTH = 2;
const KEY_PREFIX = "saas.workspace.billing.payment_method";
const FULL_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const { data, error, load, refresh } = useBillingStatus();
const { data: plan, load: loadPlan } = useTenantPlan();
const { open: openPlanComparison } = usePlanComparison();
const { t, locale } = useI18n();

const card = computed(() => data.value?.paymentMethod ?? null);
const needsUpdate = computed(() => data.value?.status === PAST_DUE_STATUS);
const isFreePlan = computed(
  () => (plan.value?.current?.price ?? FREE_PLAN_PRICE) <= FREE_PLAN_PRICE,
);
// Card details are owner-only in the API payload: a member is told who
// manages the card rather than shown a misleading "no card".
const isTenantOwner = computed(() => !!data.value?.isTenantOwner);
const hasStripeCustomer = computed(() => !!data.value?.hasStripeCustomer);
// A gift on the top plan needs no card: offering an upgrade there is noise.
const complimentaryAccess = computed(() =>
  resolveComplimentaryAccess(plan.value),
);

const complimentaryNote = computed(() => {
  const endsOn = formatDate(
    complimentaryAccess.value?.endsAt,
    locale.value,
    FULL_DATE_FORMAT,
  );
  return endsOn
    ? t(`${KEY_PREFIX}.complimentary_until_note`, { date: endsOn })
    : t(`${KEY_PREFIX}.complimentary_note`);
});

// "You'll be asked for a card on upgrade" is only true without a Stripe
// customer: once one exists, a missing card is added through the portal.
const noCardKey = computed(() =>
  hasStripeCustomer.value ? "none_with_portal" : "none",
);

const headerBadge = computed<PaymentMethodBadge>(() => {
  if (complimentaryAccess.value) {
    return { color: "success", key: "complimentary" };
  }
  if (!card.value) return { color: "warning", key: "missing" };
  if (needsUpdate.value) return { color: "warning", key: "needs_update" };
  if (isFreePlan.value) return { color: "success", key: "verified" };
  return { color: "success", key: "active" };
});

const cardBadge = computed<PaymentMethodBadge>(() => {
  if (needsUpdate.value) return { color: "warning", key: "declined" };
  if (isFreePlan.value) return { color: "success", key: "never_charged" };
  return { color: "neutral", key: "default" };
});

const expiryLabel = computed(() => {
  if (!card.value) return "";
  const month = String(card.value.expMonth).padStart(EXPIRY_PAD_LENGTH, "0");
  const year = String(card.value.expYear % EXPIRY_YEAR_MODULO).padStart(
    EXPIRY_PAD_LENGTH,
    "0",
  );
  return `${month}/${year}`;
});

onMounted(() => {
  void loadPlan();
  return load();
});
</script>

<template>
  <DmsSaasLoadFailure v-if="error && !data" @retry="refresh" />
  <UCard v-else-if="data">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ $t(`${KEY_PREFIX}.title`) }}</h3>
        <UBadge
          v-if="isTenantOwner"
          :color="headerBadge.color"
          variant="subtle"
        >
          {{ $t(`${KEY_PREFIX}.${headerBadge.key}`) }}
        </UBadge>
      </div>
    </template>

    <p v-if="!isTenantOwner" class="text-muted text-sm">
      {{ $t(`${KEY_PREFIX}.owner_only`) }}
    </p>

    <div v-else class="flex flex-col gap-4">
      <div
        v-if="complimentaryAccess"
        class="border-default flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3"
      >
        <UIcon name="i-ph-gift" class="text-muted size-5" />
        <span class="text-muted grow text-sm">{{ complimentaryNote }}</span>
      </div>

      <template v-else-if="card">
        <div
          class="border-default flex flex-wrap items-center gap-3 rounded-lg border p-3"
        >
          <UIcon name="i-ph-credit-card" class="text-muted size-5" />
          <span class="font-medium capitalize">
            {{ card.brand }} •••• {{ card.last4 }}
          </span>
          <span class="text-muted text-sm">
            {{ $t(`${KEY_PREFIX}.expires`, { date: expiryLabel }) }}
          </span>
          <span class="grow" />
          <UBadge :color="cardBadge.color" variant="subtle">
            {{ $t(`${KEY_PREFIX}.${cardBadge.key}`) }}
          </UBadge>
        </div>
        <p v-if="needsUpdate" class="text-muted text-sm">
          {{ $t(`${KEY_PREFIX}.update_note`) }}
        </p>
        <p v-else-if="isFreePlan" class="text-muted text-sm">
          {{ $t(`${KEY_PREFIX}.free_note`) }}
        </p>
      </template>

      <div
        v-else
        class="border-default flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3"
      >
        <UIcon name="i-ph-credit-card" class="text-muted size-5" />
        <span class="text-muted grow text-sm">
          {{ $t(`${KEY_PREFIX}.${noCardKey}`) }}
        </span>
        <UButton
          v-if="!hasStripeCustomer"
          size="sm"
          color="primary"
          variant="subtle"
          icon="i-ph-plus"
          @click="openPlanComparison"
        >
          {{ $t(`${KEY_PREFIX}.add`) }}
        </UButton>
      </div>

      <div
        v-if="hasStripeCustomer"
        class="border-default flex flex-wrap items-center gap-3 border-t pt-4"
      >
        <DmsSaasCustomerPortalButton />
        <p class="text-muted grow text-xs">
          {{ $t(`${KEY_PREFIX}.portal_hint`) }}
        </p>
      </div>
    </div>
  </UCard>
</template>
