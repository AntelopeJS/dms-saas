<script setup lang="ts">
import { onMounted, ref } from "vue";

interface InvitationRow {
  _id: string;
  _instance: string;
  email?: string;
}

const props = defineProps<{
  rowData?: InvitationRow;
  onSuccessCallback?: () => void;
}>();

const nuxtApp = useDmsApp();
const { resolveApiError } = useApiErrorMessage();
const { fetchInvitationLink, copyLink } = useInvitationLink();

const link = ref<string | null>(null);
const expiresAt = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const isLoading = ref(true);

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(nuxtApp.$i18n.locale.value, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function load(): Promise<void> {
  if (!props.rowData) return;
  try {
    const invitation = await fetchInvitationLink({
      tenantId: props.rowData._instance,
      inviteId: props.rowData._id,
    });
    link.value = invitation.link;
    expiresAt.value = invitation.expiresAt;
  } catch (error) {
    errorMessage.value = resolveApiError(
      error,
      "saas.workspaces.invitations.link.error",
    );
  } finally {
    isLoading.value = false;
  }
}

async function copy(): Promise<void> {
  if (!link.value) return;
  await copyLink(link.value);
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <USkeleton v-if="isLoading" class="h-10 w-full" />
    <UAlert
      v-else-if="errorMessage"
      color="error"
      variant="subtle"
      icon="i-ph-warning-circle"
      :description="errorMessage"
    />
    <template v-else-if="link">
      <UFormField
        :label="$t('saas.workspaces.invitations.link.label')"
        :help="
          expiresAt
            ? $t('saas.workspaces.invitations.link.expires', {
                date: formatDate(expiresAt),
              })
            : undefined
        "
      >
        <div class="flex gap-2">
          <UInput
            :model-value="link"
            readonly
            class="w-full"
            data-testid="invitation-link"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <UButton icon="i-ph-copy" color="primary" @click="copy">
            {{ $t("saas.workspaces.invitations.link.copy") }}
          </UButton>
        </div>
      </UFormField>
      <p class="text-muted text-xs">
        {{ $t("saas.workspaces.invitations.link.warning") }}
      </p>
    </template>
    <div class="flex justify-end">
      <UButton
        color="neutral"
        variant="ghost"
        @click="props.onSuccessCallback?.()"
      >
        {{ $t("saas.workspaces.invitations.link.close") }}
      </UButton>
    </div>
  </div>
</template>
