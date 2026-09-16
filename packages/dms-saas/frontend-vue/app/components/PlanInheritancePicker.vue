<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

const { $authFetch } = useAuthFetch();

interface FeatureCatalogItem {
  _id: string;
  displayName: string;
  valueType: "boolean" | "number";
}

interface PlanCatalogItem {
  _id: string;
  name: string;
  permissions: string[];
  features: { featureId: string; value: unknown }[];
}

interface Catalog {
  plans: PlanCatalogItem[];
  features: FeatureCatalogItem[];
}

interface InheritanceValue {
  parentPlanId: string | null;
  extraPermissions: string[];
  extraFeatures: Record<string, boolean | number>;
}

const props = defineProps<{
  modelValue?: InheritanceValue | string | null;
  initialValue?: InheritanceValue | string | null;
  disabled?: boolean;
  catalogUrl?: string;
  permissionsTreeUrl?: string;
  componentId?: string;
  pageId?: string;
  routeParams?: Record<string, string>;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const CATALOG_URL = computed(() => props.catalogUrl ?? "/api/saas/plans/catalog");
const PERMISSIONS_URL = computed(
  () => props.permissionsTreeUrl ?? "/api/saas/plans/permissions-tree",
);

function parseValue(
  raw: InheritanceValue | string | null | undefined,
): InheritanceValue {
  let v: Partial<InheritanceValue> | null = null;
  if (typeof raw === "string") {
    try {
      v = raw ? JSON.parse(raw) : null;
    } catch {
      v = null;
    }
  } else if (raw && typeof raw === "object") {
    v = raw;
  }
  return {
    parentPlanId: v?.parentPlanId ?? null,
    extraPermissions: v?.extraPermissions ? [...v.extraPermissions] : [],
    extraFeatures: { ...(v?.extraFeatures ?? {}) },
  };
}

const state = ref<InheritanceValue>(
  parseValue(props.modelValue ?? props.initialValue),
);

const catalog = ref<Catalog>({ plans: [], features: [] });
const isLoading = ref(true);
const initialSnapshotDone = ref(false);

const isInheriting = ref(state.value.parentPlanId !== null);

const currentPlanId = computed(() => props.routeParams?.id);

const planOptions = computed(() =>
  catalog.value.plans
    .filter((p) => p._id !== currentPlanId.value)
    .map((p) => ({ value: p._id, label: p.name })),
);

const parentPlan = computed(() =>
  catalog.value.plans.find((p) => p._id === state.value.parentPlanId),
);

const inheritedFeatureKeys = computed(
  () => new Set((parentPlan.value?.features ?? []).map((f) => f.featureId)),
);

function emitState(): void {
  emit("update:modelValue", JSON.stringify(state.value));
}

function onPermissionsUpdate(ids: string[]): void {
  state.value.extraPermissions = ids;
  emitState();
}

function setFeatureValue(
  feature: FeatureCatalogItem,
  value: boolean | number,
): void {
  state.value.extraFeatures = {
    ...state.value.extraFeatures,
    [feature._id]: value,
  };
  emitState();
}

function featureModel(feature: FeatureCatalogItem): boolean | number {
  const v = state.value.extraFeatures[feature._id];
  if (v !== undefined) return v;
  // Default to -1 for number features = "disabled". Admin must opt in by
  // setting a non-negative value to activate the quota.
  return feature.valueType === "boolean" ? false : -1;
}

function isNumberFeatureEnabled(feature: FeatureCatalogItem): boolean {
  const v = featureModel(feature);
  return typeof v === "number" && v >= 0;
}

function setNumberFeatureEnabled(
  feature: FeatureCatalogItem,
  enabled: boolean,
): void {
  setFeatureValue(feature, enabled ? 0 : -1);
}

function toggleInherit(value: boolean | "indeterminate"): void {
  const checked = value === true;
  isInheriting.value = checked;
  if (!checked) {
    state.value.parentPlanId = null;
    emitState();
  }
}

function selectParent(planId: string | null): void {
  state.value.parentPlanId = planId;
  const parent = catalog.value.plans.find((p) => p._id === planId);
  if (parent) {
    // Permissions: union (parent always wins for additions; manual extras on
    // the child are kept).
    const perms = new Set([
      ...state.value.extraPermissions,
      ...parent.permissions,
    ]);
    state.value.extraPermissions = [...perms];
    // Features: live inheritance — overwrite with the parent's current value
    // for any feature the parent configures. Features the parent does not
    // configure are left untouched (purely local additions on the child).
    const features = { ...state.value.extraFeatures };
    for (const f of parent.features) {
      features[f.featureId] = f.value as boolean | number;
    }
    state.value.extraFeatures = features;
  }
  emitState();
}

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    catalog.value = await $authFetch<Catalog>(CATALOG_URL.value);
  } finally {
    isLoading.value = false;
  }
}

function maybeInitialSnapshot(): void {
  // Re-snapshot from the live parent the first time we have both the
  // modelValue (parent id) AND the catalog loaded. Parent values win for any
  // feature the parent configures (live inheritance).
  if (
    !initialSnapshotDone.value &&
    !isLoading.value &&
    state.value.parentPlanId
  ) {
    initialSnapshotDone.value = true;
    selectParent(state.value.parentPlanId);
  }
}

watch(
  () => props.modelValue,
  (next) => {
    if (typeof next === "string" && next === JSON.stringify(state.value)) return;
    state.value = parseValue(next ?? props.initialValue);
    isInheriting.value = state.value.parentPlanId !== null;
    maybeInitialSnapshot();
  },
);

onMounted(async () => {
  await load();
  maybeInitialSnapshot();
  if (!initialSnapshotDone.value) {
    // Normalise the form state to a JSON string so validation passes even if
    // the field is never touched.
    emitState();
  }
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="isLoading" class="flex items-center gap-2 text-muted">
      <UIcon name="i-ph-spinner" class="animate-spin" />
      <span>{{ $t("saas.plans.inheritance.loading") }}</span>
    </div>

    <template v-else>
      <div class="flex flex-col gap-2">
        <UCheckbox
          :model-value="isInheriting"
          :disabled="disabled"
          :label="$t('saas.plans.inheritance.toggle')"
          @update:model-value="toggleInherit"
        />
        <USelect
          v-if="isInheriting"
          :model-value="state.parentPlanId ?? undefined"
          :items="planOptions"
          :disabled="disabled"
          :placeholder="$t('saas.plans.inheritance.select_plan')"
          @update:model-value="selectParent"
        />
        <p
          v-if="isInheriting && parentPlan"
          class="text-xs text-muted"
        >
          {{ $t("saas.plans.inheritance.snapshot_hint") }}
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5">
          <h4 class="text-sm font-semibold">
            {{ $t("saas.plans.field.permissions") }}
          </h4>
          <UTooltip :text="$t('saas.plans.inheritance.permissions_tooltip')">
            <UIcon name="i-ph-info" class="text-muted size-4" />
          </UTooltip>
        </div>
        <DmsPermissionsTree
          :model-value="state.extraPermissions"
          :fetch-url="PERMISSIONS_URL"
          :component-id="componentId ?? ''"
          :page-id="pageId ?? ''"
          @update:model-value="onPermissionsUpdate"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5">
          <h4 class="text-sm font-semibold">
            {{ $t("saas.plans.field.features") }}
          </h4>
          <UTooltip :text="$t('saas.plans.inheritance.features_tooltip')">
            <UIcon name="i-ph-info" class="text-muted size-4" />
          </UTooltip>
        </div>
        <div
          v-if="catalog.features.length === 0"
          class="text-xs text-muted"
        >
          {{ $t("saas.plans.inheritance.no_features") }}
        </div>
        <div
          v-else
          class="flex flex-col gap-2 rounded-md border border-default p-3"
        >
          <div
            v-for="feature in catalog.features"
            :key="feature._id"
            class="flex items-center justify-between gap-3"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm">{{ feature.displayName }}</span>
              <UBadge
                v-if="inheritedFeatureKeys.has(feature._id)"
                size="xs"
                variant="soft"
                color="neutral"
              >
                {{ $t("saas.plans.inheritance.inherited") }}
              </UBadge>
            </div>
            <USwitch
              v-if="feature.valueType === 'boolean'"
              :model-value="featureModel(feature) === true"
              :disabled="disabled"
              @update:model-value="(v: boolean) => setFeatureValue(feature, v)"
            />
            <div
              v-else-if="feature.valueType === 'number'"
              class="flex items-center gap-2"
            >
              <USwitch
                :model-value="isNumberFeatureEnabled(feature)"
                :disabled="disabled"
                @update:model-value="
                  (v: boolean) => setNumberFeatureEnabled(feature, v)
                "
              />
              <UInput
                v-if="isNumberFeatureEnabled(feature)"
                type="number"
                min="0"
                class="w-24"
                :model-value="Number(featureModel(feature))"
                :disabled="disabled"
                @update:model-value="
                  (v: number) =>
                    setFeatureValue(feature, Math.max(0, Number(v) || 0))
                "
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
