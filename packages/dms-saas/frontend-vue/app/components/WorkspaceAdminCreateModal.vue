<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface PlanOption {
  _id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
}

type CreatedOwner =
  | { kind: "added"; userId: string }
  | { kind: "invited"; inviteId: string };

interface CreatedWorkspace {
  tenantId: string;
  owner: CreatedOwner;
  invitationEmail: "sent" | "failed" | null;
}

const props = defineProps<{
  onSuccessCallback?: () => void;
  onCancelCallback?: () => void;
}>();

const PLANS_ENDPOINT = "/api/saas/plans";
const CREATE_ENDPOINT = "/modules/saas/customers/workspaces/create";
const WARNING_TOAST_DURATION = 0;
// Heard by the back-office counters, which refetch through a watch action
// declared on the workspaces page.
const WORKSPACE_CREATED_EVENT = "DmsSaas.Workspaces.Created";
const WORKSPACE_CREATED_SOURCE = "saas.workspaces.create";

const { $authFetch } = useAuthFetch();
const nuxtApp = useDmsApp();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { fetchAndCopy } = useInvitationLink();

const plans = ref<PlanOption[]>([]);
const name = ref("");
const planId = ref<string | undefined>(undefined);
const ownerEmail = ref("");
const isFreeWorkspace = ref(true);
const freeUntil = ref("");
const isLoading = ref(true);
const isSubmitting = ref(false);
const errorMessage = ref<string | null>(null);

const planItems = computed(() =>
  plans.value
    .filter((plan) => plan.isActive && !plan.isDeleted)
    .map((plan) => ({ value: plan._id, label: plan.name })),
);

const canSubmit = computed(
  () => !!name.value.trim() && !!planId.value && !!ownerEmail.value.trim(),
);

async function load(): Promise<void> {
  try {
    plans.value = await $authFetch<PlanOption[]>(PLANS_ENDPOINT);
  } catch (error) {
    errorMessage.value = resolveApiError(
      error,
      "saas.workspaces.admin.create.error.load",
    );
  } finally {
    isLoading.value = false;
  }
}

function notifyCreated(created: CreatedWorkspace): void {
  const t = nuxtApp.$i18n.t;
  const { owner } = created;
  if (created.invitationEmail !== "failed" || owner.kind !== "invited") {
    toast.add({
      title: t("saas.workspaces.admin.create.success"),
      color: "success",
      icon: "i-ph-check-circle",
    });
    return;
  }
  // The workspace exists and the owner is invited, but nobody told them: the
  // operator has to hand the link over, so the notice stays until dismissed.
  toast.add({
    title: t("saas.workspaces.admin.create.email_failed.title"),
    description: t("saas.workspaces.admin.create.email_failed.description"),
    color: "warning",
    icon: "i-ph-warning",
    duration: WARNING_TOAST_DURATION,
    actions: [
      {
        label: t("saas.workspaces.invitations.action.copy_link"),
        icon: "i-ph-link",
        onClick: () =>
          fetchAndCopy({ tenantId: created.tenantId, inviteId: owner.inviteId }),
      },
    ],
  });
}

async function submit(): Promise<void> {
  if (isSubmitting.value || !canSubmit.value) return;
  errorMessage.value = null;
  isSubmitting.value = true;
  try {
    const created = await $authFetch<CreatedWorkspace>(CREATE_ENDPOINT, {
      method: "POST",
      body: {
        name: name.value.trim(),
        planId: planId.value,
        ownerEmail: ownerEmail.value.trim(),
        freeWorkspace: isFreeWorkspace.value,
        freeUntil:
          isFreeWorkspace.value && freeUntil.value ? freeUntil.value : null,
      },
    });
    notifyCreated(created);
    window.dispatchEvent(
      new CustomEvent(WORKSPACE_CREATED_EVENT, {
        detail: { component: WORKSPACE_CREATED_SOURCE },
      }),
    );
    props.onSuccessCallback?.();
  } catch (error) {
    errorMessage.value = resolveApiError(
      error,
      "saas.workspaces.admin.create.error.failed",
    );
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="isLoading" class="flex flex-col gap-3">
    <USkeleton class="h-10 w-full" />
    <USkeleton class="h-10 w-full" />
  </div>
  <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
    <UFormField
      :label="$t('saas.workspaces.admin.create.field.name')"
      :description="$t('saas.workspaces.admin.create.field.name_description')"
      required
    >
      <UInput
        v-model="name"
        :placeholder="$t('saas.workspaces.admin.create.placeholder.name')"
        class="w-full"
        autofocus
      />
    </UFormField>
    <UFormField
      :label="$t('saas.workspaces.admin.create.field.plan')"
      :description="$t('saas.workspaces.admin.create.field.plan_description')"
      required
    >
      <USelect
        v-model="planId"
        :items="planItems"
        :placeholder="$t('saas.workspaces.admin.create.placeholder.plan')"
        class="w-full"
      />
    </UFormField>
    <UFormField
      :label="$t('saas.workspaces.admin.create.field.owner_email')"
      :description="
        $t('saas.workspaces.admin.create.field.owner_email_description')
      "
      required
    >
      <UInput
        v-model="ownerEmail"
        type="email"
        :placeholder="$t('saas.workspaces.admin.create.placeholder.owner_email')"
        class="w-full"
      />
    </UFormField>
    <UFormField
      :description="
        $t('saas.workspaces.admin.create.field.free_workspace_description')
      "
    >
      <USwitch
        v-model="isFreeWorkspace"
        :label="$t('saas.workspaces.admin.create.field.free_workspace')"
      />
    </UFormField>
    <UFormField
      v-if="isFreeWorkspace"
      :label="$t('saas.workspaces.admin.create.field.free_until')"
      :description="
        $t('saas.workspaces.admin.create.field.free_until_description')
      "
    >
      <UInput v-model="freeUntil" type="date" class="w-full" />
    </UFormField>

    <p v-if="errorMessage" class="text-error text-sm">{{ errorMessage }}</p>

    <div class="flex justify-end gap-2">
      <UButton
        v-if="props.onCancelCallback"
        color="neutral"
        variant="ghost"
        :disabled="isSubmitting"
        @click="props.onCancelCallback()"
      >
        {{ $t("common.cancel") }}
      </UButton>
      <UButton
        type="submit"
        color="primary"
        :loading="isSubmitting"
        :disabled="!canSubmit"
      >
        {{ $t("saas.workspaces.admin.create.submit") }}
      </UButton>
    </div>
  </form>
</template>
