<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

const CURRENT_ENDPOINT = "/api/saas/workspaces/current";
const AFTER_DELETE_ROUTE = "/";

const { $authFetch } = useAuthFetch();
const { resolveApiError } = useApiErrorMessage();
const toast = useToast();
const { workspace, load } = useCurrentWorkspace();
const { workspaces, refresh: refreshMyWorkspaces } = useMyWorkspaces();

const isLoading = ref(true);
const isConfirmOpen = ref(false);
const isDeleting = ref(false);
const confirmation = ref("");

const workspaceName = computed(() => workspace.value?.name ?? "");
const retentionDays = computed(() => workspace.value?.retentionDays ?? 0);
// The name gate collapses to "" === "" when the workspace never loaded, which
// would arm the delete button with the input untouched.
const canDelete = computed(
  () =>
    workspaceName.value.length > 0 &&
    confirmation.value.trim() === workspaceName.value &&
    !isDeleting.value,
);

async function initialize(): Promise<void> {
  try {
    if (!workspace.value) await load();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.general.error.load"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isLoading.value = false;
  }
}

function openConfirm(): void {
  confirmation.value = "";
  isConfirmOpen.value = true;
}

async function leaveDeletedWorkspace(): Promise<void> {
  // Staying would land on the suspended screen: the gate refuses a cancelled
  // workspace. Move to another one of the user's when there is any.
  const fallback = await resolveFallbackWorkspaceId();
  if (fallback) {
    await useTenantSwitch(fallback, AFTER_DELETE_ROUTE);
    return;
  }
  if (typeof window !== "undefined") {
    window.location.href = AFTER_DELETE_ROUTE;
  }
}

async function resolveFallbackWorkspaceId(): Promise<string | null> {
  await refreshMyWorkspaces().catch(() => undefined);
  const other = workspaces.value.find(
    (candidate) => candidate._id !== workspace.value?._id,
  );
  return other?._id ?? null;
}

async function confirmDelete(): Promise<void> {
  if (!canDelete.value) return;
  isDeleting.value = true;
  try {
    await $authFetch(CURRENT_ENDPOINT, { method: "DELETE" });
    await leaveDeletedWorkspace();
  } catch (error) {
    isDeleting.value = false;
    toast.add({
      title: resolveApiError(error, "saas.workspace.general.error.delete"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  }
}

onMounted(initialize);
</script>

<template>
  <div
    class="border-error/40 flex flex-col gap-3 rounded-md border p-4"
  >
    <h3 class="text-error text-sm font-semibold">
      {{ $t("saas.workspace.general.danger_zone_title") }}
    </h3>
    <USkeleton v-if="isLoading" class="h-10 w-full" />
    <div v-else class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-muted max-w-xl text-sm">
        {{ $t("saas.workspace.general.delete_intro", { days: retentionDays }) }}
      </p>
      <UButton color="error" variant="outline" @click="openConfirm">
        {{ $t("saas.workspace.general.delete_action") }}
      </UButton>
    </div>

    <UModal
      v-model:open="isConfirmOpen"
      :title="$t('saas.workspace.general.delete_action')"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <p class="text-sm">
            {{
              $t("saas.workspace.general.delete_warning", {
                name: workspaceName,
                days: retentionDays,
              })
            }}
          </p>
          <UFormField
            :label="$t('saas.workspace.general.delete_confirm_label')"
          >
            <UInput v-model="confirmation" :placeholder="workspaceName" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              :disabled="isDeleting"
              @click="isConfirmOpen = false"
            >
              {{ $t("saas.workspace.general.cancel") }}
            </UButton>
            <UButton
              color="error"
              :disabled="!canDelete"
              :loading="isDeleting"
              @click="confirmDelete"
            >
              {{ $t("saas.workspace.general.delete_submit") }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
