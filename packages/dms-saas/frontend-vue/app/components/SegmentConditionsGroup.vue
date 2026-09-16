<script setup lang="ts">
import { computed } from "vue";

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
type Quantifier = "any" | "all";
type MemberRole = "member" | "owner";
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
  quantifier: Quantifier;
  role?: MemberRole;
  conditions: ConditionGroup;
}

type ConditionNode = Condition | ConditionGroup | WorkspaceRef;

interface ConditionGroup {
  logical: Logical;
  conditions: ConditionNode[];
}

const MAX_DEPTH = 5;

const props = defineProps<{
  modelValue: ConditionGroup;
  catalog: FieldsCatalog;
  workspaceCatalog?: FieldsCatalog;
  allowWorkspaceRef?: boolean;
  depth: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: ConditionGroup] }>();

const { t } = useI18n();

const logicalOptions = computed(() => [
  { value: "and", label: t("saas.segments.conditions.and") },
  { value: "or", label: t("saas.segments.conditions.or") },
]);

const quantifierOptions = computed(() => [
  { value: "any", label: t("saas.segments.quantifier.any") },
  { value: "all", label: t("saas.segments.quantifier.all") },
]);

const roleOptions = computed(() => [
  { value: "member", label: t("saas.segments.role.any") },
  { value: "owner", label: t("saas.segments.role.owner") },
]);

const fieldOptions = computed(() =>
  props.catalog.fields.map((f) => ({
    value: f.id,
    label: t(f.labelKey),
  })),
);

const canNestGroup = computed(() => props.depth < MAX_DEPTH);

function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).logical !== undefined;
}

function isWorkspaceRef(node: ConditionNode): node is WorkspaceRef {
  return (node as WorkspaceRef).kind === "workspaceRef";
}

function findField(fieldId: string): FieldDefinition | undefined {
  return props.catalog.fields.find((f) => f.id === fieldId);
}

function operatorOptions(
  fieldId: string,
): { value: Operator; label: string }[] {
  const field = findField(fieldId);
  const ops = field?.operators ?? [];
  return ops.map((op) => ({
    value: op,
    label: t(`saas.segments.operators.${op}`),
  }));
}

const ISO_DATE_LENGTH = 10;

const DEFAULT_VALUE_BY_KIND: Partial<Record<ValueKind, () => unknown>> = {
  number: () => 0,
  boolean: () => false,
  date: () => new Date().toISOString().slice(0, ISO_DATE_LENGTH),
};

function defaultValueFor(field: FieldDefinition | undefined): unknown {
  if (!field) return "";
  const buildDefault = DEFAULT_VALUE_BY_KIND[field.valueKind];
  return buildDefault ? buildDefault() : (field.enumValues?.[0] ?? "");
}

function emitUpdate(next: ConditionGroup): void {
  emit("update:modelValue", next);
}

function setLogical(logical: Logical): void {
  emitUpdate({ ...props.modelValue, logical });
}

function addCondition(): void {
  const firstField = props.catalog.fields[0];
  const newCondition: Condition = {
    field: firstField?.id ?? "",
    operator: (firstField?.operators[0] ?? "eq") as Operator,
    value: defaultValueFor(firstField),
  };
  emitUpdate({
    ...props.modelValue,
    conditions: [...props.modelValue.conditions, newCondition],
  });
}

function addGroup(): void {
  emitUpdate({
    ...props.modelValue,
    conditions: [
      ...props.modelValue.conditions,
      { logical: "and", conditions: [] },
    ],
  });
}

function addWorkspaceRef(): void {
  emitUpdate({
    ...props.modelValue,
    conditions: [
      ...props.modelValue.conditions,
      {
        kind: "workspaceRef",
        quantifier: "any",
        role: "member",
        conditions: { logical: "and", conditions: [] },
      },
    ],
  });
}

function removeAt(index: number): void {
  emitUpdate({
    ...props.modelValue,
    conditions: props.modelValue.conditions.filter((_, i) => i !== index),
  });
}

function replaceAt(index: number, next: ConditionNode): void {
  const conditions = [...props.modelValue.conditions];
  conditions[index] = next;
  emitUpdate({ ...props.modelValue, conditions });
}

function updateRefQuantifier(index: number, quantifier: Quantifier): void {
  const existing = props.modelValue.conditions[index] as WorkspaceRef;
  replaceAt(index, { ...existing, quantifier });
}

function updateRefRole(index: number, role: MemberRole): void {
  const existing = props.modelValue.conditions[index] as WorkspaceRef;
  replaceAt(index, { ...existing, role });
}

function updateRefConditions(index: number, conditions: ConditionGroup): void {
  const existing = props.modelValue.conditions[index] as WorkspaceRef;
  replaceAt(index, { ...existing, conditions });
}

function updateConditionField(index: number, fieldId: string): void {
  const existing = props.modelValue.conditions[index] as Condition;
  const field = findField(fieldId);
  const operator =
    field && !field.operators.includes(existing.operator)
      ? (field.operators[0] as Operator)
      : existing.operator;
  replaceAt(index, {
    ...existing,
    field: fieldId,
    operator,
    value: defaultValueFor(field),
  });
}

function updateConditionOperator(index: number, operator: Operator): void {
  const existing = props.modelValue.conditions[index] as Condition;
  let value = existing.value;
  if (operator === "in" || operator === "nin") {
    if (!Array.isArray(value)) value = value ? [value] : [];
  } else if (Array.isArray(value)) {
    value = value[0] ?? "";
  }
  replaceAt(index, { ...existing, operator, value });
}

function updateConditionValue(index: number, value: unknown): void {
  const existing = props.modelValue.conditions[index] as Condition;
  replaceAt(index, { ...existing, value });
}

function enumValuesFor(
  field: FieldDefinition,
): { value: string; label: string }[] {
  if (field.type === "enum:plan") {
    return props.catalog.plans.map((p) => ({ value: p._id, label: p.name }));
  }
  return (field.enumValues ?? []).map((v) => ({ value: v, label: v }));
}

const CURRENCY_SYMBOL = "€";

const UNIT_SUFFIX_BUILDERS: Record<
  NonNullable<FieldDefinition["unit"]>,
  () => string
> = {
  currency: () => CURRENCY_SYMBOL,
  days: () => t("saas.segments.units.days"),
  count: () => t("saas.segments.units.count"),
};

function unitSuffix(field: FieldDefinition | undefined): string {
  if (!field?.unit) return "";
  return UNIT_SUFFIX_BUILDERS[field.unit]?.() ?? "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}
</script>

<template>
  <div
    class="rounded-md border border-default p-3 flex flex-col gap-3"
    :class="depth > 0 ? 'bg-elevated/40' : ''"
  >
    <div class="flex items-center gap-2">
      <span class="text-xs uppercase tracking-wide text-muted">
        {{ $t("saas.segments.conditions.logical_label") }}
      </span>
      <USelect
        :model-value="modelValue.logical"
        :items="logicalOptions"
        size="sm"
        class="w-24"
        :disabled="disabled"
        @update:model-value="setLogical($event as Logical)"
      />
    </div>

    <div
      v-for="(node, index) in modelValue.conditions"
      :key="index"
      class="flex items-start gap-2"
    >
      <template v-if="isWorkspaceRef(node)">
        <div
          class="flex-1 rounded-md border border-primary/40 p-3 flex flex-col gap-2"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-ph-buildings" class="text-primary" />
            <span class="text-xs uppercase tracking-wide text-muted">
              {{ $t("saas.segments.conditions.workspace_ref_label") }}
            </span>
            <USelect
              :model-value="node.role ?? 'member'"
              :items="roleOptions"
              size="sm"
              class="w-36"
              :disabled="disabled"
              @update:model-value="updateRefRole(index, $event as MemberRole)"
            />
            <USelect
              :model-value="node.quantifier"
              :items="quantifierOptions"
              size="sm"
              class="w-36"
              :disabled="disabled"
              @update:model-value="
                updateRefQuantifier(index, $event as Quantifier)
              "
            />
          </div>
          <DmsSaasSegmentConditionsGroup
            :model-value="node.conditions"
            :catalog="workspaceCatalog ?? catalog"
            :depth="depth + 1"
            :disabled="disabled"
            @update:model-value="updateRefConditions(index, $event)"
          />
        </div>
        <UButton
          v-if="!disabled"
          color="error"
          variant="ghost"
          icon="i-ph-x"
          size="sm"
          @click="removeAt(index)"
        />
      </template>
      <template v-else-if="isGroup(node)">
        <DmsSaasSegmentConditionsGroup
          :model-value="node"
          :catalog="catalog"
          :workspace-catalog="workspaceCatalog"
          :allow-workspace-ref="allowWorkspaceRef"
          :depth="depth + 1"
          :disabled="disabled"
          class="flex-1"
          @update:model-value="replaceAt(index, $event)"
        />
        <UButton
          v-if="!disabled"
          color="error"
          variant="ghost"
          icon="i-ph-x"
          size="sm"
          @click="removeAt(index)"
        />
      </template>
      <template v-else>
        <div class="grid grid-cols-[1fr_140px_1fr_auto] gap-2 flex-1 items-center">
          <USelect
            :model-value="node.field"
            :items="fieldOptions"
            :disabled="disabled"
            @update:model-value="updateConditionField(index, $event as string)"
          />
          <USelect
            :model-value="node.operator"
            :items="operatorOptions(node.field)"
            :disabled="disabled"
            @update:model-value="updateConditionOperator(index, $event as Operator)"
          />
          <div class="flex items-center gap-1">
            <template v-if="findField(node.field)">
              <template v-if="node.operator === 'in' || node.operator === 'nin'">
                <USelectMenu
                  :model-value="asStringArray(node.value)"
                  :items="enumValuesFor(findField(node.field)!)"
                  value-key="value"
                  multiple
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, $event)"
                />
              </template>
              <template v-else-if="findField(node.field)!.type === 'boolean'">
                <USelect
                  :model-value="String(node.value)"
                  :items="[
                    { value: 'true', label: $t('saas.segments.boolean.true') },
                    { value: 'false', label: $t('saas.segments.boolean.false') },
                  ]"
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, $event === 'true')"
                />
              </template>
              <template
                v-else-if="
                  findField(node.field)!.type === 'enum' ||
                  findField(node.field)!.type === 'enum:plan'
                "
              >
                <USelect
                  :model-value="node.value as string"
                  :items="enumValuesFor(findField(node.field)!)"
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, $event)"
                />
              </template>
              <template v-else-if="findField(node.field)!.valueKind === 'number'">
                <UInput
                  :model-value="node.value as number"
                  type="number"
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, Number($event))"
                />
              </template>
              <template v-else-if="findField(node.field)!.valueKind === 'date'">
                <UInput
                  :model-value="node.value as string"
                  type="date"
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, $event)"
                />
              </template>
              <template v-else>
                <UInput
                  :model-value="node.value as string"
                  :disabled="disabled"
                  class="flex-1"
                  @update:model-value="updateConditionValue(index, $event)"
                />
              </template>
              <span
                v-if="unitSuffix(findField(node.field))"
                class="text-xs text-muted"
              >
                {{ unitSuffix(findField(node.field)) }}
              </span>
            </template>
          </div>
          <UButton
            v-if="!disabled"
            color="error"
            variant="ghost"
            icon="i-ph-x"
            size="sm"
            @click="removeAt(index)"
          />
        </div>
      </template>
    </div>

    <div v-if="!disabled" class="flex gap-2">
      <UButton variant="soft" icon="i-ph-plus" size="sm" @click="addCondition">
        {{ $t("saas.segments.conditions.add") }}
      </UButton>
      <UButton
        v-if="canNestGroup"
        variant="soft"
        color="neutral"
        icon="i-ph-folder-simple-plus"
        size="sm"
        @click="addGroup"
      >
        {{ $t("saas.segments.conditions.add_group") }}
      </UButton>
      <UButton
        v-if="allowWorkspaceRef && canNestGroup"
        variant="soft"
        color="primary"
        icon="i-ph-buildings"
        size="sm"
        @click="addWorkspaceRef"
      >
        {{ $t("saas.segments.conditions.add_workspace_ref") }}
      </UButton>
    </div>
  </div>
</template>
