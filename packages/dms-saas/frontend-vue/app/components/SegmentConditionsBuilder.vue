<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

type Operator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "nin"
  | "contains";
type Logical = "and" | "or";
type ValueKind = "string" | "number" | "boolean" | "date";
type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "enum"
  | "enum:plan";

interface FieldDefinition {
  id: string;
  type: FieldType;
  valueKind: ValueKind;
  labelKey: string;
  descriptionKey: string;
  operators: readonly Operator[];
  enumValues?: readonly string[];
  unit?: "currency" | "days" | "count";
}

interface PlanOption {
  _id: string;
  name: string;
}

interface FieldsCatalogResponse {
  fields: FieldDefinition[];
  userFields?: FieldDefinition[];
  plans: PlanOption[];
}

interface FieldsCatalog {
  fields: FieldDefinition[];
  plans: PlanOption[];
}

interface Condition {
  field: string;
  operator: Operator;
  value: unknown;
}

interface WorkspaceRef {
  kind: "workspaceRef";
  quantifier: "any" | "all";
  role?: "member" | "owner";
  conditions: ConditionGroup;
}

interface ConditionGroup {
  logical: Logical;
  conditions: Array<Condition | ConditionGroup | WorkspaceRef>;
}

const props = defineProps<{
  modelValue?: ConditionGroup | string | null;
  initialValue?: ConditionGroup | string | null;
  fieldsCatalogUrl?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { $authFetch } = useAuthFetch();

const CATALOG_URL = computed(
  () => props.fieldsCatalogUrl ?? "/api/saas/segments/fields",
);

function parseValue(
  raw: ConditionGroup | string | null | undefined,
): ConditionGroup {
  let v: Partial<ConditionGroup> | null = null;
  if (typeof raw === "string") {
    try {
      v = raw ? (JSON.parse(raw) as ConditionGroup) : null;
    } catch {
      v = null;
    }
  } else if (raw && typeof raw === "object") {
    v = raw as ConditionGroup;
  }
  return {
    logical: v?.logical ?? "and",
    conditions: Array.isArray(v?.conditions) ? [...v.conditions] : [],
  };
}

const state = ref<ConditionGroup>(
  parseValue(props.modelValue ?? props.initialValue),
);
const rawCatalog = ref<FieldsCatalogResponse>({
  fields: [],
  userFields: [],
  plans: [],
});
const isLoading = ref(true);

const workspaceCatalog = computed<FieldsCatalog>(() => ({
  fields: rawCatalog.value.fields,
  plans: rawCatalog.value.plans,
}));

const userCatalog = computed<FieldsCatalog>(() => ({
  fields: rawCatalog.value.userFields ?? [],
  plans: rawCatalog.value.plans,
}));

function serialize(): string {
  return JSON.stringify({
    logical: state.value.logical,
    conditions: state.value.conditions,
  });
}

function onChildUpdate(next: ConditionGroup): void {
  state.value = next;
  emit("update:modelValue", serialize());
}

async function loadCatalog(): Promise<void> {
  isLoading.value = true;
  try {
    rawCatalog.value = await $authFetch<FieldsCatalogResponse>(
      CATALOG_URL.value,
    );
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadCatalog);

watch(
  () => props.modelValue,
  (value) => {
    const parsed = parseValue(value);
    if (JSON.stringify(parsed) !== JSON.stringify(state.value)) {
      state.value = parsed;
    }
  },
);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="isLoading" class="flex justify-center py-4">
      <UIcon name="i-ph-spinner" class="animate-spin" />
    </div>
    <template v-else>
      <DmsSaasSegmentConditionsGroup
        :model-value="state"
        :catalog="userCatalog"
        :workspace-catalog="workspaceCatalog"
        :allow-workspace-ref="true"
        :depth="0"
        :disabled="disabled"
        @update:model-value="onChildUpdate"
      />
    </template>
  </div>
</template>
