<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const ACCESS_ENDPOINT = "/api/saas/billing/access";
const HOME_REDIRECT = "/";
const LOGIN_REDIRECT = "/auth/login";
const BILLING_PATH = "/settings/workspace/billing";

const { $authFetch } = useAuthFetch();
const { clear: clearSession } = useUserSession();
const { formatMinorUnits } = useMoneyFormat();
const cachedAccess = useWorkspaceAccessCache();
const { data: billingStatusState } = useBillingStatus();
const { data: tenantPlanState } = useTenantPlan();

const access = ref<WorkspaceAccess | null>(null);
const isLoading = ref(true);
const hasError = ref(false);

const statusKey = computed(() => {
  const status = access.value?.status;
  return isBlockingSubscriptionStatus(status)
    ? `saas.workspace_suspended.status.${status}`
    : "saas.workspace_suspended.status.default";
});

const invoice = computed(() => access.value?.unpaidInvoice ?? null);
const amountLabel = computed(() =>
  formatMinorUnits(invoice.value?.amount, invoice.value?.currency),
);
const invoiceLabel = computed(() => invoice.value?.number ?? amountLabel.value);

async function loadAccess(): Promise<void> {
  isLoading.value = true;
  hasError.value = false;
  try {
    const result = await $authFetch<WorkspaceAccess>(ACCESS_ENDPOINT);
    access.value = result;
    if (!result.blocked) {
      // Drop the access and billing payloads cached while blocked before
      // navigating: an SPA navigation keeps useState alive, and the billing
      // page would keep announcing a suspension the user just settled.
      cachedAccess.value = null;
      billingStatusState.value = null;
      tenantPlanState.value = null;
      await navigateDms(HOME_REDIRECT);
    }
  } catch {
    hasError.value = true;
  } finally {
    isLoading.value = false;
  }
}

/** Same settlement route as the past-due banner: the Stripe-hosted invoice
 * page handles payment, card update and 3DS on its own. */
function settle(): void {
  const url = invoice.value?.hostedInvoiceUrl;
  if (!url || typeof window === "undefined") return;
  window.open(url, "_blank", "noopener");
}

async function logout(): Promise<void> {
  await clearSession();
  await navigateDms(LOGIN_REDIRECT);
}

onMounted(loadAccess);
</script>

<template>
  <div class="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 py-12">
    <div v-if="isLoading" class="flex justify-center">
      <UIcon name="i-ph-circle-notch" class="size-8 animate-spin" />
    </div>

    <UAlert
      v-else-if="hasError"
      color="error"
      variant="subtle"
      icon="i-ph-warning-circle"
      :title="$t('saas.workspace_suspended.load_error')"
    >
      <template #actions>
        <UButton
          color="error"
          variant="solid"
          icon="i-ph-arrows-clockwise"
          @click="loadAccess"
        >
          {{ $t("saas.workspace_suspended.recheck") }}
        </UButton>
      </template>
    </UAlert>

    <UCard v-else-if="access?.blocked">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="i-ph-lock-simple" class="size-6 text-error" />
          <h1 class="text-lg font-semibold">
            {{ $t("saas.workspace_suspended.title") }}
          </h1>
        </div>
      </template>

      <div class="flex flex-col gap-4">
        <p v-if="invoice">
          {{
            $t("saas.workspace_suspended.unpaid_invoice", {
              invoice: invoiceLabel,
              amount: amountLabel,
            })
          }}
        </p>
        <p v-else>{{ $t(statusKey) }}</p>

        <p v-if="access.isTenantOwner" class="text-muted text-sm">
          {{ $t("saas.workspace_suspended.retention_note") }}
        </p>
        <p v-else>
          {{ $t("saas.workspace_suspended.contact_owner") }}
        </p>

        <div v-if="access.isTenantOwner" class="flex flex-wrap gap-2">
          <UButton
            v-if="invoice?.hostedInvoiceUrl"
            color="primary"
            icon="i-ph-arrow-square-out"
            @click="settle"
          >
            {{ $t("saas.workspace_suspended.settle") }}
          </UButton>
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-ph-credit-card"
            :to="BILLING_PATH"
          >
            {{ $t("saas.workspace_suspended.open_billing") }}
          </UButton>
          <DmsSaasCustomerPortalButton />
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-ph-arrows-clockwise"
            @click="loadAccess"
          >
            {{ $t("saas.workspace_suspended.recheck") }}
          </UButton>
          <UButton color="neutral" variant="outline" @click="logout">
            {{ $t("saas.workspace_suspended.logout") }}
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
