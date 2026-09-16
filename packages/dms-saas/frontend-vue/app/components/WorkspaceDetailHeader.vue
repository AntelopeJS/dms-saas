<script setup lang="ts">
defineProps<{
  routeParams?: Record<string, string>;
}>();
</script>

<template>
  <section class="flex grow gap-4">
    <div
      class="flex size-12 shrink-0 items-center justify-center rounded-lg bg-default shadow-sm ring ring-default"
    >
      <UIcon name="i-ph-building" class="text-primary" size="1.75rem" />
    </div>

    <div class="flex-1">
      <h1 class="font-semibold text-highlighted">
        {{ $t("saas.workspaces.detail") }}
      </h1>
      <p class="text-sm text-muted">
        {{ $t("saas.workspaces.detail_description") }}
      </p>
    </div>
  </section>
</template>
