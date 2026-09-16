import { defineComponent, h, resolveComponent } from "vue";

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

interface WorkspaceRef {
  kind: "workspaceRef";
  quantifier: "any" | "all";
  role?: "member" | "owner";
  conditions: ConditionGroup;
}

type ConditionNode = Condition | ConditionGroup | WorkspaceRef;

interface ConditionGroup {
  logical: "and" | "or";
  conditions: ConditionNode[];
}

const MAX_INLINE_CONDITIONS = 2;
const OPERATOR_SYMBOLS: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "∈",
  nin: "∉",
  contains: "~",
};

function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).logical !== undefined;
}

function isWorkspaceRef(node: ConditionNode): node is WorkspaceRef {
  return (node as WorkspaceRef).kind === "workspaceRef";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "…";
  const str = String(value);
  return str.length > 20 ? `${str.slice(0, 20)}…` : str;
}

function renderNode(node: ConditionNode): string {
  if (isWorkspaceRef(node)) {
    const role = node.role === "owner" ? "owner:" : "";
    return `ws:${role}${node.quantifier}(${node.conditions?.conditions?.length ?? 0})`;
  }
  if (isGroup(node)) {
    if (!node.conditions?.length) return "()";
    return `(${node.conditions.length} ${node.logical.toUpperCase()})`;
  }
  const op = OPERATOR_SYMBOLS[node.operator] ?? node.operator;
  return `${node.field} ${op} ${formatValue(node.value)}`;
}

function parseValue(raw: unknown): ConditionGroup | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ConditionGroup;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as ConditionGroup;
  return null;
}

function renderConditionsPreview(value: unknown): string {
  const group = parseValue(value);
  if (!group?.conditions?.length) return "—";
  const sep = group.logical === "or" ? " OR " : " AND ";
  const items = group.conditions
    .slice(0, MAX_INLINE_CONDITIONS)
    .map(renderNode);
  const remaining = group.conditions.length - MAX_INLINE_CONDITIONS;
  const tail = remaining > 0 ? ` +${remaining}` : "";
  return `${items.join(sep)}${tail}`;
}

const SegmentConditionsDisplay = defineComponent({
  name: "SegmentConditionsDisplay",
  props: {
    modelValue: {
      type: [Object, String] as unknown as () =>
        | ConditionGroup
        | string
        | null,
      default: null,
    },
    fieldsCatalogUrl: { type: String, default: undefined },
  },
  setup(props) {
    const builder = resolveComponent("DmsSaasSegmentConditionsBuilder");
    return () =>
      h(builder, {
        modelValue: props.modelValue,
        fieldsCatalogUrl: props.fieldsCatalogUrl,
        disabled: true,
      });
  },
});

export default defineDmsPlugin(() => {
  const { registerDataType } = useDataTypes();
  registerDataType({
    id: "segment_conditions",
    displayComponent: SegmentConditionsDisplay,
    formatter: {
      default: (value: unknown) => renderConditionsPreview(value),
    },
  });
});
