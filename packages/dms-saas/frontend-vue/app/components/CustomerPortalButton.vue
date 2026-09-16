<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const PORTAL_ENDPOINT = "/api/saas/billing/portal-session";

const { $authFetch } = useAuthFetch();
const { data, load } = useBillingStatus();
const isLoading = ref(false);

const isAvailable = computed(
  () => !!data.value?.hasStripeCustomer && !!data.value?.isTenantOwner,
);

async function openCustomerPortal(): Promise<void> {
  isLoading.value = true;
  try {
    const result = await $authFetch<{ url: string }>(PORTAL_ENDPOINT, {
      method: "POST",
      body: {
        returnUrl: typeof window !== "undefined" ? window.location.href : "/",
      },
    });
    if (typeof window !== "undefined") {
      window.location.href = result.url;
    }
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <UButton
    v-if="isAvailable"
    color="neutral"
    variant="subtle"
    icon="i-ph-arrow-square-out"
    :loading="isLoading"
    @click="openCustomerPortal"
  >
    {{ $t("saas.workspace.billing.manage") }}
  </UButton>
</template>
