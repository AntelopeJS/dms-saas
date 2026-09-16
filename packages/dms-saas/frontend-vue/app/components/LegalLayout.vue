<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

interface DmsPublicRuntime {
  baseURL: string;
}

interface LegalDocuments {
  [field: string]: string;
}

interface LegalLayoutProps {
  endpoint: string;
  documentField: string;
}

const props = defineProps<LegalLayoutProps>();

const config = useDmsRuntimeConfig();
const dmsRuntime = config.public.dms as DmsPublicRuntime;
const apiFetch = $fetch.create({ baseURL: dmsRuntime.baseURL });
const data = ref<LegalDocuments>({});

async function loadDocument(): Promise<void> {
  try {
    data.value = await apiFetch<LegalDocuments>(props.endpoint);
  } catch {
    data.value = {};
  }
}

onMounted(loadDocument);

const content = computed(() => data.value?.[props.documentField] ?? "");
</script>

<template>
  <UContainer class="mx-auto max-w-4xl">
    <UCard v-if="content">
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        class="prose prose-neutral dark:prose-invert max-w-none"
        v-html="content"
      />
    </UCard>

    <UEmpty
      v-else
      icon="i-ph-file-text"
      :title="$t('saas.legal.no_content_title')"
      :description="$t('saas.legal.no_content_message')"
      class="min-h-96"
    />

    <div class="mt-8 flex items-center justify-center">
      <UButton
        to="/auth"
        :label="$t('button.go_home')"
        icon="i-lucide-arrow-right"
      />
    </div>
  </UContainer>
</template>
