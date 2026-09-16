<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const { $authFetch } = useAuthFetch();

interface BillingInfo {
  customerType: string | null;
  companyName: string | null;
  vatNumber: string | null;
}

interface WorkspaceBillingInfoResponse {
  billingInfo: BillingInfo | null;
}

const props = defineProps<{
  routeParams?: Record<string, string>;
}>();

const tenantId = computed(() => props.routeParams?.id ?? "");
const { triggerRef } = useDetailRefresh(tenantId.value);
const billing = ref<BillingInfo | null>(null);
const isLoading = ref(true);

async function load(): Promise<void> {
  if (!tenantId.value) return;
  isLoading.value = true;
  try {
    const detail = await $authFetch<WorkspaceBillingInfoResponse>(
      `/api/saas/workspaces/${tenantId.value}`,
    );
    billing.value = detail.billingInfo;
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
watch(triggerRef, () => {
  void load();
});
</script>

<template>
  <DmsCard v-if="!isLoading && billing">
    <div
      class="-mx-5 sm:-mx-6 -mt-5 sm:-mt-6 mb-5 sm:mb-6 border-b border-default px-5 sm:px-6 py-4"
    >
      <h3 class="font-semibold">
        {{ $t("saas.workspaces.billing_section") }}
      </h3>
    </div>
    <dl class="grid grid-cols-2 gap-3 text-sm">
      <dt class="text-muted">
        {{ $t("saas.workspaces.column.customer_type") }}
      </dt>
      <dd>{{ billing.customerType ?? "—" }}</dd>
      <dt class="text-muted">
        {{ $t("saas.workspaces.column.company_name") }}
      </dt>
      <dd>{{ billing.companyName ?? "—" }}</dd>
      <dt class="text-muted">
        {{ $t("saas.workspaces.column.vat_number") }}
      </dt>
      <dd>{{ billing.vatNumber ?? "—" }}</dd>
    </dl>
  </DmsCard>
</template>
