import { assert } from "@antelopejs/interface-api-util";
import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentWorkspaceRef,
} from "../db";
import type { SegmentNode } from "./segment-evaluator";
import { findSegmentField, type SegmentFieldCatalog } from "./segment-fields";
import type { JsonValue } from "@antelopejs/interface-dms-saas/json";
import { isObjectOrNull, isString } from "./primitive-guards";

const HTTP_BAD_REQUEST = 400;
const ERRORS = "saas.errors.segments";
/**
 * Must cover the deepest tree the UI builder can produce, counted in
 * validator levels (root group = 1, each nested group/condition/workspaceRef
 * = +1). The builder nests groups down to UI depth 5 (root = 0); the deepest
 * leaf sits inside a workspaceRef added at UI depth 4: root(1) → group(2) →
 * group(3) → group(4) → group(5) → ref(6) → inner group(7) → condition(8).
 */
const MAX_CONDITION_DEPTH = 8;
const ROOT_DEPTH = 1;
const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const LIST_OPERATORS = new Set(["in", "nin"]);

/** A segment's editable fields, validated. */
export interface SegmentInput {
  name: string;
  description: string;
  conditions: SegmentConditionGroup;
}

/** The body of a segment save, as it arrives. */
export interface SegmentInputBody {
  name?: JsonValue;
  description?: JsonValue;
  conditions?: JsonValue;
}

/** A segment node as a client sent it: every key may hold anything. */
interface Document {
  kind?: unknown;
  logical?: unknown;
  conditions?: unknown;
  quantifier?: unknown;
  role?: unknown;
  field?: unknown;
  operator?: unknown;
  value?: unknown;
}

function isDocument(value: unknown): value is Document {
  return isObjectOrNull(value) && value !== null;
}

function holdsLogical(node: Document): boolean {
  return "logical" in node && node.logical !== undefined;
}

function assertWorkspaceRefNode(
  node: Document,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is Document & SegmentWorkspaceRef {
  assert(catalog === "user", HTTP_BAD_REQUEST, `${ERRORS}.invalid_conditions`);
  assert(
    node.quantifier === "any" || node.quantifier === "all",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_quantifier`,
  );
  assert(
    node.role === undefined || node.role === "member" || node.role === "owner",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_role`,
  );
  assert(
    isDocument(node.conditions) && holdsLogical(node.conditions),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  assertConditionNode(node.conditions, depth + 1, "workspace");
}

function assertGroupNode(
  node: Document,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is Document & SegmentConditionGroup {
  assert(
    node.logical === "and" || node.logical === "or",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_logical`,
  );
  const children = node.conditions;
  assert(
    Array.isArray(children),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  for (const child of children) {
    assertConditionNode(child, depth + 1, catalog);
  }
}

/**
 * Whether the rules are, or hold at any depth, an object with an own
 * `__proto__` key, under a known key or an extra one. Walks with a stack, so
 * a deeply nested tree cannot overflow the call stack.
 */
function holdsOwnProtoKey(rules: Document): boolean {
  const pending: unknown[] = [rules];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !isObjectOrNull(current)) continue;
    if (Object.hasOwn(current, "__proto__")) return true;
    for (const child of Object.values(current)) pending.push(child);
  }
  return false;
}

function assertLeafCondition(
  condition: Document,
  catalog: SegmentFieldCatalog,
): asserts condition is Document & SegmentCondition {
  const field = isString(condition.field)
    ? findSegmentField(condition.field, catalog)
    : undefined;
  assert(field, HTTP_BAD_REQUEST, `${ERRORS}.unknown_field`);
  const operator = condition.operator;
  assert(
    field.operators.some((allowed) => allowed === operator),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_operator`,
  );
  assert(
    (isString(operator) && LIST_OPERATORS.has(operator)) ===
      Array.isArray(condition.value),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_value`,
  );
}

function assertConditionNode(
  node: unknown,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is SegmentNode {
  assert(
    depth <= MAX_CONDITION_DEPTH,
    HTTP_BAD_REQUEST,
    `${ERRORS}.conditions_too_deep`,
  );
  assert(isDocument(node), HTTP_BAD_REQUEST, `${ERRORS}.invalid_conditions`);
  if (node.kind === "workspaceRef") {
    assertWorkspaceRefNode(node, depth, catalog);
    return;
  }
  if (holdsLogical(node)) {
    assertGroupNode(node, depth, catalog);
    return;
  }
  assertLeafCondition(node, catalog);
}

/**
 * The conditions of a segment, from the JSON string or the object a client
 * sends, checked against the field catalogs. An empty value is an empty AND
 * group, which matches nobody.
 */
export function parseSegmentConditions(
  raw: JsonValue | undefined,
): SegmentConditionGroup {
  if (raw === undefined || raw === null || raw === "") {
    return { logical: "and", conditions: [] };
  }
  let parsed: unknown = raw;
  if (isString(raw)) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }
  assert(
    isDocument(parsed) &&
      holdsLogical(parsed) &&
      parsed.kind !== "workspaceRef",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  assert(
    !holdsOwnProtoKey(parsed),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  assertGroupNode(parsed, ROOT_DEPTH, "user");
  return parsed;
}

function parseText(value: JsonValue | undefined, maxLength: number): string {
  const text = isString(value) ? value.trim() : "";
  assert(text.length <= maxLength, HTTP_BAD_REQUEST, `${ERRORS}.too_long`);
  return text;
}

function parseName(value: JsonValue | undefined): string {
  const name = parseText(value, NAME_MAX_LENGTH);
  assert(name.length > 0, HTTP_BAD_REQUEST, `${ERRORS}.name_required`);
  return name;
}

/**
 * The fields of a new segment. The name is required: a segment is listed
 * and picked by it.
 */
export function parseSegmentInput(body: SegmentInputBody): SegmentInput {
  return {
    name: parseName(body.name),
    description: parseText(body.description, DESCRIPTION_MAX_LENGTH),
    conditions: parseSegmentConditions(body.conditions),
  };
}

/**
 * The fields an edit changes: only the ones the body carries, each checked
 * as on creation.
 */
export function parseSegmentPatch(
  body: SegmentInputBody,
): Partial<SegmentInput> {
  const patch: Partial<SegmentInput> = {};
  if (body.name !== undefined) patch.name = parseName(body.name);
  if (body.description !== undefined) {
    patch.description = parseText(body.description, DESCRIPTION_MAX_LENGTH);
  }
  if (body.conditions !== undefined) {
    patch.conditions = parseSegmentConditions(body.conditions);
  }
  return patch;
}
