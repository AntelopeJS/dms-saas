<script setup lang="ts">
import { computed, onMounted } from "vue";

const BLOCKING_STATUSES = new Set(["pending_payment", "suspended", "cancelled"]);

// Bound to the shared state, not a snapshot: a plan change made from the
// sibling plan card must update the banner without a remount.
const { data, load } = useTenantPlan();

onMounted(() => {
  void load();
});

const freeUntilDate = computed<Date | null>(() => {
  if (!data.value?.freeUntil) return null;
  const parsed = new Date(data.value.freeUntil);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
});

const isExpired = computed(() => {
  return (
    data.value?.status !== null &&
    BLOCKING_STATUSES.has(data.value?.status ?? "")
  );
});

const showBanner = computed(() => {
  if (!data.value?.isComplimentary) return false;
  return true;
});

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
</script>

<template>
  <UAlert
    v-if="showBanner && isExpired"
    color="error"
    variant="subtle"
    :title="$t('saas.workspace.free_access.expired_title')"
    :description="$t('saas.workspace.free_access.expired_description')"
    icon="i-ph-warning"
  />
  <UAlert
    v-else-if="showBanner && freeUntilDate"
    color="warning"
    variant="subtle"
    :title="$t('saas.workspace.free_access.banner_title')"
    :description="
      $t('saas.workspace.free_access.banner_description', {
        date: formatDate(freeUntilDate),
      })
    "
    icon="i-ph-hourglass"
  />
  <UAlert
    v-else-if="showBanner"
    color="info"
    variant="subtle"
    :title="$t('saas.workspace.free_access.indefinite_title')"
    :description="$t('saas.workspace.free_access.indefinite_description')"
    icon="i-ph-gift"
  />
</template>
