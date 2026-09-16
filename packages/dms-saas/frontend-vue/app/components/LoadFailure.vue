<script setup lang="ts">
defineProps<{ title?: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <UAlert
    color="error"
    variant="subtle"
    icon="i-ph-warning-circle"
    :title="title ?? $t('saas.common.load_failed')"
  >
    <template #actions>
      <UButton
        color="error"
        variant="soft"
        size="xs"
        icon="i-ph-arrow-clockwise"
        @click="emit('retry')"
      >
        {{ $t("saas.common.retry") }}
      </UButton>
    </template>
  </UAlert>
</template>
