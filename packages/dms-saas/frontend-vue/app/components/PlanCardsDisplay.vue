<script setup lang="ts">
import { onMounted, ref } from "vue";

const { $authFetch } = useAuthFetch();
const { resolveApiError } = useApiErrorMessage();

interface Plan {
  _id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  audience: string;
  isActive: boolean;
  borderColor: string | null;
  borderLabel: string | null;
  order: number;
  trialDays: number;
  maxMembers: number;
  workspaceCount: number;
  features?: { featureId: string; value: unknown }[];
}

interface FeatureCatalogItem {
  _id: string;
  displayName: string;
  valueType: string;
}

interface FeatureMeta {
  displayName: string;
  valueType: string;
}

interface DisplayContext {
  refresh: () => void | Promise<void>;
}

const PLANS_ENDPOINT = "/api/saas/plans";
const PAGE_SIZE = 24;

const props = defineProps<{ context: DisplayContext }>();

const plans = ref<Plan[]>([]);
const featureMeta = ref<Record<string, FeatureMeta>>({});
const isLoading = ref(true);
const reorderError = ref<string | null>(null);

function sortPlans(list: Plan[]): Plan[] {
  return [...list].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.order - b.order,
  );
}

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    const [list, catalog] = await Promise.all([
      $authFetch<Plan[]>(PLANS_ENDPOINT),
      $authFetch<{ features: FeatureCatalogItem[] }>(
        `${PLANS_ENDPOINT}/catalog`,
      ),
    ]);
    plans.value = sortPlans(list);
    featureMeta.value = Object.fromEntries(
      catalog.features.map((f) => [
        f._id,
        { displayName: f.displayName, valueType: f.valueType },
      ]),
    );
  } finally {
    isLoading.value = false;
  }
}

async function reorder(updated: Plan[]): Promise<void> {
  reorderError.value = null;
  const previous = [...plans.value];
  plans.value = updated;
  try {
    const items = updated.map((plan, index) => ({
      id: plan._id,
      order: index,
    }));
    await $authFetch(`${PLANS_ENDPOINT}/reorder`, {
      method: "POST",
      body: { items },
    });
  } catch (error) {
    plans.value = previous;
    reorderError.value = resolveApiError(error, "saas.plans.reorder_failed");
  }
}

async function onChanged(): Promise<void> {
  await props.context.refresh();
}

onMounted(load);
defineExpose({ refresh: load });
</script>

<template>
  <div class="flex flex-col gap-4 mt-4">
    <p v-if="reorderError" class="text-error">{{ reorderError }}</p>
    <div v-if="isLoading" class="flex justify-center py-8">
      <UIcon name="i-ph-spinner" class="animate-spin" />
    </div>
    <DmsSaasCardGrid
      v-else
      :items="plans"
      :page-size="PAGE_SIZE"
      draggable
      @reorder="reorder"
    >
      <template #card="{ item }">
        <DmsSaasPlanCard
          :plan="item"
          :feature-meta="featureMeta"
          @changed="onChanged"
        />
      </template>
    </DmsSaasCardGrid>
  </div>
</template>
