<script setup lang="ts">
import { computed, ref } from "vue";

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();

const props = defineProps<{
  routeParams?: Record<string, string>;
}>();

const tenantId = computed(() => props.routeParams?.id ?? "");
const { trigger } = useDetailRefresh(tenantId.value);
const isJoining = ref(false);

async function joinAsMember(): Promise<void> {
  isJoining.value = true;
  try {
    await $authFetch(`/api/saas/workspaces/${tenantId.value}/join`, {
      method: "POST",
    });
    toast.add({
      title: nuxtApp.$i18n.t("saas.workspaces.join.success"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    trigger();
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspaces.join.error"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isJoining.value = false;
  }
}
</script>

<template>
  <UButton
    icon="i-ph-user-plus"
    color="primary"
    :loading="isJoining"
    @click="joinAsMember"
  >
    {{ $t("saas.workspaces.join.button") }}
  </UButton>
</template>
