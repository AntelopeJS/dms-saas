<script setup lang="ts">
import { onMounted, ref } from "vue";

interface ActivityEntry {
  id: string;
  icon: string;
  iconColor: SemanticColor;
  title: string;
  subtitle: string;
  timestamp: string;
}

const RECENT_ACTIVITY_URL = "/api/saas/dashboard/recent-activity";
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

const { $authFetch } = useAuthFetch();
const { locale } = useI18n();

const entries = ref<ActivityEntry[]>([]);
const isLoading = ref(true);

function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const format = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
  if (diff < MS_PER_HOUR) {
    return format.format(-Math.round(diff / MS_PER_MINUTE), "minute");
  }
  if (diff < MS_PER_DAY) {
    return format.format(-Math.round(diff / MS_PER_HOUR), "hour");
  }
  return format.format(-Math.round(diff / MS_PER_DAY), "day");
}

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    entries.value = await $authFetch<ActivityEntry[]>(RECENT_ACTIVITY_URL);
  } finally {
    isLoading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">{{ $t("saas.dashboard.recent_activity") }}</h2>
    </template>
    <div v-if="isLoading" class="flex justify-center py-6">
      <UIcon name="i-ph-spinner" class="animate-spin text-2xl" />
    </div>
    <p v-else-if="!entries.length" class="text-muted py-6 text-center text-sm">
      {{ $t("saas.dashboard.activity.empty") }}
    </p>
    <div v-else class="flex flex-col">
      <DmsActivityItem
        v-for="entry in entries"
        :key="entry.id"
        :icon="entry.icon"
        :icon-color="entry.iconColor"
        :title="entry.title"
        :subtitle="$t(entry.subtitle)"
        :trailing="relativeTime(entry.timestamp)"
      />
    </div>
  </UCard>
</template>
