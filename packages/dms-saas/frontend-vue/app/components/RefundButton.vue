<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface RefundEligibility {
  eligible: boolean;
  reason: string | null;
  windowDays: number;
  mode: string | null;
  refundAmount: number | null;
  currency: string | null;
}

const ELIGIBILITY_ENDPOINT = "/api/saas/billing/refund-eligibility";
const REFUND_ENDPOINT = "/api/saas/billing/refund-self";
const CENTS_PER_UNIT = 100;

const REFRESH_SCOPE = "tenant-billing";

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { trigger } = useDetailRefresh(REFRESH_SCOPE);

const eligibility = ref<RefundEligibility | null>(null);
const isModalOpen = ref(false);
const isSubmitting = ref(false);

const isEligible = computed(() => eligibility.value?.eligible === true);

const formattedAmount = computed(() => {
  const amount = eligibility.value?.refundAmount;
  if (amount == null) return "";
  const currency = (eligibility.value?.currency ?? "").toUpperCase();
  return `${(amount / CENTS_PER_UNIT).toFixed(2)} ${currency}`.trim();
});

async function loadEligibility(): Promise<void> {
  try {
    eligibility.value =
      await $authFetch<RefundEligibility>(ELIGIBILITY_ENDPOINT);
  } catch {
    eligibility.value = null;
  }
}

async function confirmRefund(): Promise<void> {
  isSubmitting.value = true;
  try {
    await $authFetch(REFUND_ENDPOINT, { method: "POST" });
    toast.add({
      title: nuxtApp.$i18n.t("saas.workspace.billing.refund.success"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    isModalOpen.value = false;
    await loadEligibility();
    trigger();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.billing.refund.error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isSubmitting.value = false;
  }
}

/** The eligibility read is owner-only and, like the refund itself, closed
 * while the access gate blocks the workspace: the card has nothing to offer
 * then, so it skips the request instead of collecting a 403. */
async function loadIfOffered(): Promise<void> {
  const access = await loadWorkspaceAccess();
  if (access && (access.blocked || !access.isTenantOwner)) return;
  await loadEligibility();
}

onMounted(loadIfOffered);
</script>

<template>
  <UCard v-if="isEligible">
    <template #header>
      <h3 class="font-semibold">
        {{ $t("saas.workspace.billing.refund.title") }}
      </h3>
    </template>
    <div class="flex flex-col gap-4">
      <p class="text-muted text-sm">
        {{
          $t("saas.workspace.billing.refund.description", {
            amount: formattedAmount,
          })
        }}
      </p>
      <div class="flex justify-end">
        <UButton
          color="error"
          variant="soft"
          icon="i-ph-arrow-counter-clockwise"
          @click="isModalOpen = true"
        >
          {{ $t("saas.workspace.billing.refund.button") }}
        </UButton>
      </div>
    </div>

    <UModal
      :open="isModalOpen"
      :title="$t('saas.workspace.billing.refund.confirm_title')"
      @update:open="isModalOpen = $event"
    >
      <template #body>
        <p>
          {{
            $t("saas.workspace.billing.refund.confirm_message", {
              amount: formattedAmount,
            })
          }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="isModalOpen = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton color="error" :loading="isSubmitting" @click="confirmRefund">
            {{ $t("saas.workspace.billing.refund.confirm_action") }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
