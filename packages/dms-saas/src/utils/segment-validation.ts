import { assert } from "@antelopejs/interface-api-util";
import { z } from "zod";
import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentWorkspaceRef,
} from "../db";
import type { SegmentNode } from "./segment-evaluator";
import { findSegmentField, type SegmentFieldCatalog } from "./segment-fields";
import type { JsonValue } from "./json-value";
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

/** A JSON object: neither `null` nor an array. */
type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return !!value && isObjectOrNull(value) && !Array.isArray(value);
}

function isJsonGroup(value: JsonValue | undefined): value is JsonObject {
  return isJsonObject(value) && value.logical !== undefined;
}

function isJsonWorkspaceRef(value: JsonValue | undefined): value is JsonObject {
  return isJsonObject(value) && value.kind === "workspaceRef";
}

function assertWorkspaceRefNode(
  node: JsonObject,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is JsonObject & SegmentWorkspaceRef {
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
    isJsonGroup(node.conditions),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  assertConditionNode(node.conditions, depth + 1, "workspace");
}

function assertGroupNode(
  node: JsonObject,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is JsonObject & SegmentConditionGroup {
  assert(
    node.logical === "and" || node.logical === "or",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_logical`,
  );
  const { conditions } = node;
  assert(
    Array.isArray(conditions),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  for (const child of conditions) {
    assertConditionNode(child, depth + 1, catalog);
  }
}

function assertLeafCondition(
  node: JsonValue | undefined,
  catalog: SegmentFieldCatalog,
): asserts node is JsonObject & SegmentCondition {
  assert(isJsonObject(node), HTTP_BAD_REQUEST, `${ERRORS}.unknown_field`);
  const field = isString(node.field)
    ? findSegmentField(node.field, catalog)
    : undefined;
  assert(field, HTTP_BAD_REQUEST, `${ERRORS}.unknown_field`);
  const operator = field.operators.find(
    (candidate) => candidate === node.operator,
  );
  assert(operator, HTTP_BAD_REQUEST, `${ERRORS}.invalid_operator`);
  assert(
    LIST_OPERATORS.has(operator) === Array.isArray(node.value),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_value`,
  );
}

function assertConditionNode(
  node: JsonValue | undefined,
  depth: number,
  catalog: SegmentFieldCatalog,
): asserts node is JsonObject & SegmentNode {
  assert(
    depth <= MAX_CONDITION_DEPTH,
    HTTP_BAD_REQUEST,
    `${ERRORS}.conditions_too_deep`,
  );
  assert(
    !!node && isObjectOrNull(node),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  if (isJsonWorkspaceRef(node)) {
    assertWorkspaceRefNode(node, depth, catalog);
    return;
  }
  if (isJsonGroup(node)) {
    assertGroupNode(node, depth, catalog);
    return;
  }
  assertLeafCondition(node, catalog);
}

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

function parseJson(raw: string): JsonValue | undefined {
  try {
    return jsonValueSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function assertSegmentGroup(
  parsed: JsonValue | undefined,
): asserts parsed is JsonObject & SegmentConditionGroup {
  assert(isJsonGroup(parsed), HTTP_BAD_REQUEST, `${ERRORS}.invalid_conditions`);
  assertConditionNode(parsed, ROOT_DEPTH, "user");
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
  const parsed = isString(raw) ? parseJson(raw) : raw;
  assertSegmentGroup(parsed);
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
