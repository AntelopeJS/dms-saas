<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface PlanRowData {
  _id?: string;
  name?: string;
  workspaceCount?: number;
}

interface PlanOption {
  _id: string;
  name: string;
  isActive: boolean;
  isDeleted: boolean;
}

interface DeletionPreparePayload {
  affectedTenantsCount: number;
  removedPermissions: string[];
  addedPermissions: string[];
  unchangedPermissions: string[];
}

const PLANS_ENDPOINT = "/api/saas/plans";
const DELETE_ENDPOINT = "/api/saas/plans-deletion";

const props = defineProps<{
  rowData?: PlanRowData;
  onSuccessCallback?: () => void;
}>();

const { t } = useI18n();
const toast = useToast();
const { $authFetch } = useAuthFetch();
const { resolveApiError } = useApiErrorMessage();

const planId = computed(() => props.rowData?._id ?? "");
const planName = computed(() => props.rowData?.name ?? "");
const requiresMigration = computed(
  () => (props.rowData?.workspaceCount ?? 0) > 0,
);

const availablePlans = ref<PlanOption[]>([]);
const targetPlanId = ref<string | undefined>(undefined);
const notifyMembers = ref(true);
const preparing = ref(false);
const submitting = ref(false);
const errorMessage = ref<string | null>(null);
const preview = ref<DeletionPreparePayload | null>(null);

const targetOptions = computed(() =>
  availablePlans.value
    .filter((p) => p._id !== planId.value && p.isActive && !p.isDeleted)
    .map((p) => ({ value: p._id, label: p.name })),
);

async function loadPlans(): Promise<void> {
  if (!requiresMigration.value) return;
  availablePlans.value = await $authFetch<PlanOption[]>(PLANS_ENDPOINT);
}

async function loadPreview(): Promise<void> {
  if (!targetPlanId.value) {
    preview.value = null;
    return;
  }
  preparing.value = true;
  try {
    preview.value = await $authFetch<DeletionPreparePayload>(
      `${DELETE_ENDPOINT}/${planId.value}/prepare/${targetPlanId.value}`,
    );
  } finally {
    preparing.value = false;
  }
}

function notifySuccess(): void {
  toast.add({
    title: t(
      requiresMigration.value
        ? "saas.plans.delete.migration_started"
        : "saas.plans.delete.success",
    ),
    color: "success",
    icon: "i-ph-check-circle",
  });
  props.onSuccessCallback?.();
}

async function deleteSimple(): Promise<void> {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await $authFetch(`${PLANS_ENDPOINT}/${planId.value}`, { method: "DELETE" });
    notifySuccess();
  } catch (error) {
    errorMessage.value = resolveApiError(error, "saas.plans.delete.failed");
  } finally {
    submitting.value = false;
  }
}

async function deleteWithMigration(): Promise<void> {
  if (!targetPlanId.value) {
    errorMessage.value = t("saas.plans.delete.no_target");
    return;
  }
  submitting.value = true;
  errorMessage.value = null;
  try {
    await $authFetch(`${DELETE_ENDPOINT}/${planId.value}/migrate-and-delete`, {
      method: "POST",
      body: {
        targetPlanId: targetPlanId.value,
        notifyMembers: notifyMembers.value,
      },
    });
    notifySuccess();
  } catch (error) {
    errorMessage.value = resolveApiError(error, "saas.plans.delete.failed");
  } finally {
    submitting.value = false;
  }
}

function submit(): Promise<void> {
  return requiresMigration.value ? deleteWithMigration() : deleteSimple();
}

watch(planId, () => {
  targetPlanId.value = undefined;
  preview.value = null;
  errorMessage.value = null;
  void loadPlans();
});

watch(targetPlanId, () => {
  void loadPreview();
});

onMounted(loadPlans);
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="font-medium">
      {{
        $t(
          requiresMigration
            ? "saas.plans.delete.migration_title"
            : "saas.plans.delete.simple_title",
          { name: planName },
        )
      }}
    </p>

    <template v-if="requiresMigration">
      <p class="text-muted text-sm">
        {{
          $t("saas.plans.delete.migrate_intro", {
            count: rowData?.workspaceCount ?? 0,
          })
        }}
      </p>
      <UFormField :label="$t('saas.plans.delete.target_label')">
        <USelect
          v-model="targetPlanId"
          :items="targetOptions"
          :placeholder="$t('saas.plans.delete.target_placeholder')"
          class="w-full"
        />
      </UFormField>
      <UCheckbox
        v-model="notifyMembers"
        :label="$t('saas.plans.delete.notify_members')"
      />
      <div v-if="preparing" class="text-muted text-sm">
        {{ $t("saas.plans.delete.computing_diff") }}
      </div>
      <UCard v-else-if="preview">
        <p class="font-semibold">
          {{
            $t("saas.plans.delete.affected_count", {
              count: preview.affectedTenantsCount,
            })
          }}
        </p>
        <div v-if="preview.removedPermissions.length" class="mt-2">
          <p class="text-muted text-sm">
            {{ $t("saas.plans.delete.permissions_removed") }}
          </p>
          <ul class="list-disc pl-5 text-sm">
            <li v-for="perm in preview.removedPermissions" :key="perm">
              {{ perm }}
            </li>
          </ul>
        </div>
      </UCard>
    </template>

    <p v-else class="text-muted text-sm">
      {{ $t("saas.plans.delete.simple_warning") }}
    </p>

    <p v-if="errorMessage" class="text-error">{{ errorMessage }}</p>

    <div class="flex justify-end">
      <UButton
        color="error"
        :loading="submitting"
        :disabled="requiresMigration && (!targetPlanId || preparing)"
        :icon="requiresMigration ? 'i-ph-arrows-clockwise' : 'i-ph-trash'"
        @click="submit"
      >
        {{
          requiresMigration
            ? $t("saas.plans.delete.confirm")
            : $t("saas.plans.delete.simple_confirm")
        }}
      </UButton>
    </div>
  </div>
</template>
