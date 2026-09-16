<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface AdminState {
  status: string | null;
  planId: string | null;
  hasStripeSubscription: boolean;
  freeUntil: string | null;
}

const SUSPENDED_STATUS = "suspended";

interface PlanOption {
  _id: string;
  name: string;
  audience: string;
  isActive: boolean;
  isDeleted: boolean;
}

const STATE_ENDPOINT_PREFIX = "/api/saas/workspaces";
const PLANS_ENDPOINT = "/api/saas/plans";

const props = defineProps<{
  routeParams?: Record<string, string>;
}>();

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();

const tenantId = computed(() => props.routeParams?.id ?? "");
const { trigger } = useDetailRefresh(tenantId.value);

const state = ref<AdminState | null>(null);
const plans = ref<PlanOption[]>([]);
const isLoading = ref(true);
const isModalOpen = ref(false);
const isSubmitting = ref(false);

const selectedPlanId = ref<string | undefined>(undefined);
const freeUntil = ref<string>("");

const planItems = computed(() =>
  plans.value
    .filter((plan) => plan.isActive && !plan.isDeleted)
    .map((plan) => ({ value: plan._id, label: plan.name })),
);

const isComplimentary = computed(
  () =>
    !!state.value &&
    !!state.value.planId &&
    !state.value.hasStripeSubscription,
);

const isSuspended = computed(() => state.value?.status === SUSPENDED_STATUS);

const buttonLabel = computed(() =>
  nuxtApp.$i18n.t(
    isComplimentary.value
      ? "saas.workspaces.admin.comp.update"
      : "saas.workspaces.admin.comp.grant",
  ),
);

async function loadAll(): Promise<void> {
  if (!tenantId.value) return;
  isLoading.value = true;
  try {
    const [adminState, planList] = await Promise.all([
      $authFetch<AdminState>(
        `${STATE_ENDPOINT_PREFIX}/${tenantId.value}/admin-state`,
      ),
      $authFetch<PlanOption[]>(PLANS_ENDPOINT),
    ]);
    state.value = adminState;
    plans.value = planList;
    selectedPlanId.value = adminState.planId ?? undefined;
    freeUntil.value = adminState.freeUntil
      ? adminState.freeUntil.slice(0, 10)
      : "";
  } catch {
    state.value = null;
  } finally {
    isLoading.value = false;
  }
}

function openModal(): void {
  selectedPlanId.value = state.value?.planId ?? undefined;
  freeUntil.value = state.value?.freeUntil
    ? state.value.freeUntil.slice(0, 10)
    : "";
  isModalOpen.value = true;
}

async function submit(): Promise<void> {
  if (!selectedPlanId.value) return;
  isSubmitting.value = true;
  try {
    await $authFetch(
      `${STATE_ENDPOINT_PREFIX}/${tenantId.value}/grant-free-access`,
      {
        method: "POST",
        body: {
          planId: selectedPlanId.value,
          freeUntil: freeUntil.value || null,
        },
      },
    );
    toast.add({
      title: nuxtApp.$i18n.t("saas.workspaces.admin.comp.success"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    isModalOpen.value = false;
    await loadAll();
    trigger();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.admin.comp.error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <div v-if="!isLoading && state" class="flex justify-end">
    <UButton color="primary" variant="soft" icon="i-ph-gift" @click="openModal">
      {{ buttonLabel }}
    </UButton>

    <UModal
      :open="isModalOpen"
      :title="$t('saas.workspaces.admin.comp.modal_title')"
      @update:open="isModalOpen = $event"
    >
      <template #body>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <p class="text-muted text-sm">
            {{ $t("saas.workspaces.admin.comp.modal_description") }}
          </p>
          <UFormField :label="$t('saas.workspaces.admin.comp.plan')">
            <USelect
              v-model="selectedPlanId"
              :items="planItems"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('saas.workspaces.admin.comp.free_until')">
            <UInput v-model="freeUntil" type="date" class="w-full" />
          </UFormField>
          <p class="text-muted text-xs">
            {{ $t("saas.workspaces.admin.comp.free_until_hint") }}
          </p>
          <UAlert
            color="info"
            variant="subtle"
            icon="i-ph-info"
            :description="
              $t('saas.workspaces.admin.comp.hint_members_preserved')
            "
          />
          <UAlert
            v-if="isSuspended"
            color="warning"
            variant="subtle"
            icon="i-ph-warning"
            :description="$t('saas.workspaces.admin.comp.hint_will_unsuspend')"
          />
        </form>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="isModalOpen = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton
            color="primary"
            :loading="isSubmitting"
            :disabled="!selectedPlanId"
            @click="submit"
          >
            {{ $t("saas.workspaces.admin.comp.submit") }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
