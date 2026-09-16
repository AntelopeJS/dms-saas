<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface AdminWorkspaceState {
  status: string | null;
  planId: string | null;
  hasStripeSubscription: boolean;
  freeUntil: string | null;
}

interface Props {
  routeParams?: Record<string, string>;
}

type SuspensionAction = "suspend" | "unsuspend";

const SUSPENDED_STATUS = "suspended";
const CANCELLED_STATUS = "cancelled";

const props = defineProps<Props>();

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();

const tenantId = computed(() => props.routeParams?.id ?? "");
const { trigger, triggerRef } = useDetailRefresh(tenantId.value);
const state = ref<AdminWorkspaceState | null>(null);
const isLoading = ref(true);
const isModalOpen = ref(false);
const isSubmitting = ref(false);
const operationId = ref(crypto.randomUUID());
const operationAction = ref<SuspensionAction | null>(null);

const isSuspended = computed(() => state.value?.status === SUSPENDED_STATUS);

const isHidden = computed(
  () => !state.value || state.value.status === CANCELLED_STATUS,
);

const buttonLabel = computed(() =>
  nuxtApp.$i18n.t(
    isSuspended.value
      ? "saas.workspaces.admin.unsuspend"
      : "saas.workspaces.admin.suspend",
  ),
);

const buttonColor = computed<"primary" | "error">(() =>
  isSuspended.value ? "primary" : "error",
);

const confirmTitle = computed(() =>
  nuxtApp.$i18n.t(
    isSuspended.value
      ? "saas.workspaces.admin.confirm_unsuspend.title"
      : "saas.workspaces.admin.confirm_suspend.title",
  ),
);

const confirmMessage = computed(() =>
  nuxtApp.$i18n.t(
    isSuspended.value
      ? "saas.workspaces.admin.confirm_unsuspend.description"
      : state.value?.hasStripeSubscription
        ? "saas.workspaces.admin.confirm_suspend.description_with_pause"
        : "saas.workspaces.admin.confirm_suspend.description_local",
  ),
);

async function loadState(): Promise<void> {
  if (!tenantId.value) return;
  isLoading.value = true;
  try {
    state.value = await $authFetch<AdminWorkspaceState>(
      `/api/saas/workspaces/${tenantId.value}/admin-state`,
    );
  } catch {
    state.value = null;
  } finally {
    isLoading.value = false;
  }
}

async function confirmAction(): Promise<void> {
  isSubmitting.value = true;
  try {
    const endpoint = isSuspended.value ? "unsuspend" : "suspend";
    await $authFetch(`/api/saas/workspaces/${tenantId.value}/${endpoint}`, {
      method: "POST",
      body: { operationId: operationId.value },
    });
    toast.add({
      title: nuxtApp.$i18n.t(
        isSuspended.value
          ? "saas.workspaces.admin.unsuspended"
          : "saas.workspaces.admin.suspended",
      ),
      color: "success",
      icon: "i-ph-check-circle",
    });
    isModalOpen.value = false;
    operationId.value = crypto.randomUUID();
    operationAction.value = null;
    trigger();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.admin.action_error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
    trigger();
  } finally {
    isSubmitting.value = false;
  }
}

function openModal(): void {
  const action = isSuspended.value ? "unsuspend" : "suspend";
  if (operationAction.value !== action) {
    operationId.value = crypto.randomUUID();
    operationAction.value = action;
  }
  isModalOpen.value = true;
}

onMounted(loadState);
watch(triggerRef, loadState);
</script>

<template>
  <div v-if="!isLoading && !isHidden" class="flex justify-end">
    <UButton
      :color="buttonColor"
      variant="soft"
      :icon="isSuspended ? 'i-ph-play' : 'i-ph-prohibit'"
      @click="openModal"
    >
      {{ buttonLabel }}
    </UButton>

    <UModal
      :open="isModalOpen"
      :title="confirmTitle"
      @update:open="isModalOpen = $event"
    >
      <template #body>
        <p>{{ confirmMessage }}</p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" @click="isModalOpen = false">
            {{ $t("common.cancel") }}
          </UButton>
          <UButton
            :color="buttonColor"
            :loading="isSubmitting"
            @click="confirmAction"
          >
            {{ buttonLabel }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
