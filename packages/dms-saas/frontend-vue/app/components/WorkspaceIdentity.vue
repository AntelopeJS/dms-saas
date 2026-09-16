<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const { t } = useI18n();
const toast = useToast();
const { resolveApiError } = useApiErrorMessage();
const { workspace, load, rename } = useCurrentWorkspace();

const name = ref("");
const isLoading = ref(true);
const isSaving = ref(false);
const loadError = ref<string | null>(null);

const savedName = computed(() => workspace.value?.name ?? "");
const isDirty = computed(() => name.value.trim() !== savedName.value);
const canSave = computed(() => isDirty.value && !!name.value.trim());

watch(savedName, (value) => {
  name.value = value;
});

async function initialize(): Promise<void> {
  try {
    await load();
    name.value = savedName.value;
    loadError.value = null;
  } catch (error) {
    loadError.value = resolveApiError(
      error,
      "saas.workspace.general.error.load",
    );
  } finally {
    isLoading.value = false;
  }
}

function reset(): void {
  name.value = savedName.value;
}

async function save(): Promise<void> {
  if (!canSave.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await rename(name.value.trim());
    toast.add({
      title: t("saas.workspace.general.renamed"),
      color: "success",
      icon: "i-ph-check-circle",
    });
  } catch (error) {
    toast.add({
      title: resolveApiError(error, "saas.workspace.general.error.rename"),
      color: "error",
      icon: "i-ph-warning-circle",
    });
  } finally {
    isSaving.value = false;
  }
}

onMounted(initialize);
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-muted text-sm">
      {{ $t("saas.workspace.general.identity_intro") }}
    </p>
    <USkeleton v-if="isLoading" class="h-10 w-full" />
    <p v-else-if="loadError" class="text-error text-sm">{{ loadError }}</p>
    <template v-else>
      <UFormField
        :label="$t('saas.workspace.general.name')"
        :description="$t('saas.workspace.general.name_hint')"
      >
        <UInput v-model="name" class="w-full" />
      </UFormField>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="!isDirty || isSaving"
          @click="reset"
        >
          {{ $t("saas.workspace.general.reset") }}
        </UButton>
        <UButton
          color="primary"
          :disabled="!canSave"
          :loading="isSaving"
          @click="save"
        >
          {{ $t("saas.workspace.general.save") }}
        </UButton>
      </div>
    </template>
  </div>
</template>
