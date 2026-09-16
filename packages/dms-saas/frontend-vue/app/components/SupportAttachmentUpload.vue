<script setup lang="ts">
import { computed, ref, watch } from "vue";

interface AttachmentConstraints {
  maxSize?: number;
  allowedMimetypes?: string[];
}
interface UploadProps {
  modelValue: string[];
  multiple?: boolean;
  constraints?: AttachmentConstraints;
  disabled?: boolean;
}
interface SupportPresign {
  resourceKey: string;
  uploadUrl: string;
  headers: Record<string, string>;
}
const props = defineProps<UploadProps>();
const emit = defineEmits<{
  "update:modelValue": [string[]];
  busy: [boolean];
}>();
const { $authFetch } = useAuthFetch();
const { uploadWithProgress } = useUploadWithProgress();
const { t } = useI18n();
const selected = ref<File | File[] | null>(null);
const names = ref(new Map<string, string>());
const isUploading = ref(false);
const progress = ref(0);
const currentName = ref("");
const error = ref("");
const accept = computed(() => props.constraints?.allowedMimetypes?.join(","));

function validate(file: File): boolean {
  const { maxSize, allowedMimetypes } = props.constraints ?? {};
  if (maxSize !== undefined && file.size > maxSize) {
    error.value = t("dms.form.file.rejected_size", {
      name: file.name,
      size: `${maxSize} B`,
    });
    return false;
  }
  if (
    allowedMimetypes?.length &&
    !allowedMimetypes.some((mime) =>
      mime.endsWith("/*")
        ? file.type.startsWith(mime.slice(0, -1))
        : mime === file.type,
    )
  ) {
    error.value = t("dms.form.file.rejected_type", { name: file.name });
    return false;
  }
  return true;
}

async function upload(file: File): Promise<void> {
  if (!validate(file)) return;
  currentName.value = file.name;
  progress.value = 0;
  const presign = await $authFetch<SupportPresign>(
    "/api/saas/support/uploads",
    {
      method: "POST",
      body: { filename: file.name, size: file.size, mimetype: file.type },
    },
  );
  await uploadWithProgress(presign, file, (value: number) => {
    progress.value = value;
  });
  names.value.set(presign.resourceKey, file.name);
  emit(
    "update:modelValue",
    props.multiple
      ? [...props.modelValue, presign.resourceKey]
      : [presign.resourceKey],
  );
}

watch(selected, async (value) => {
  if (!value || props.disabled || isUploading.value) return;
  isUploading.value = true;
  emit("busy", true);
  error.value = "";
  try {
    const files = Array.isArray(value) ? value : [value];
    for (const file of props.multiple ? files : files.slice(0, 1))
      await upload(file);
  } catch {
    error.value = t("saas.support.error.upload");
  } finally {
    selected.value = null;
    isUploading.value = false;
    emit("busy", false);
  }
});

function remove(key: string): void {
  if (props.disabled || isUploading.value) return;
  emit(
    "update:modelValue",
    props.modelValue.filter((value) => value !== key),
  );
  names.value.delete(key);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <UFileUpload
      v-model="selected"
      :multiple="multiple"
      :accept="accept"
      :disabled="disabled || isUploading"
    />
    <div v-if="isUploading" role="status" class="bg-elevated rounded-md p-2">
      <span class="text-sm">{{ currentName }}</span>
      <UProgress :model-value="progress" />
    </div>
    <p v-if="error" role="alert" class="text-error text-sm">{{ error }}</p>
    <div
      v-for="key in modelValue"
      :key="key"
      class="bg-elevated flex items-center justify-between gap-2 rounded-md p-2"
    >
      <span class="min-w-0 truncate text-sm">
        {{ names.get(key) ?? $t("saas.support.attachments") }}
      </span>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        :aria-label="$t('saas.support.remove_attachment')"
        :disabled="disabled || isUploading"
        @click="remove(key)"
      />
    </div>
  </div>
</template>
