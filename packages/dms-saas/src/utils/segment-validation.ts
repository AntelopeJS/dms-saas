import { assert } from "@antelopejs/interface-api-util";
import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentWorkspaceRef,
} from "../db";
import {
  isSegmentGroup,
  isSegmentWorkspaceRef,
  type SegmentNode,
} from "./segment-evaluator";
import { findSegmentField, type SegmentFieldCatalog } from "./segment-fields";

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
  name?: unknown;
  description?: unknown;
  conditions?: unknown;
}

function validateWorkspaceRefNode(
  node: SegmentWorkspaceRef,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
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
    !!node.conditions && isSegmentGroup(node.conditions),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  // The nested tree is evaluated against workspace projections, so it is
  // validated against the workspace catalog (and cannot nest another ref).
  validateConditionNode(node.conditions, depth + 1, "workspace");
}

function validateGroupNode(
  node: SegmentConditionGroup,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
  assert(
    node.logical === "and" || node.logical === "or",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_logical`,
  );
  assert(
    Array.isArray(node.conditions),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  for (const child of node.conditions) {
    validateConditionNode(child, depth + 1, catalog);
  }
}

function validateLeafCondition(
  condition: SegmentCondition,
  catalog: SegmentFieldCatalog,
): void {
  const field = findSegmentField(condition.field, catalog);
  assert(field, HTTP_BAD_REQUEST, `${ERRORS}.unknown_field`);
  assert(
    field.operators.includes(condition.operator),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_operator`,
  );
  assert(
    LIST_OPERATORS.has(condition.operator) === Array.isArray(condition.value),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_value`,
  );
}

function validateConditionNode(
  node: SegmentNode,
  depth: number,
  catalog: SegmentFieldCatalog,
): void {
  assert(
    depth <= MAX_CONDITION_DEPTH,
    HTTP_BAD_REQUEST,
    `${ERRORS}.conditions_too_deep`,
  );
  assert(
    !!node && typeof node === "object",
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  if (isSegmentWorkspaceRef(node)) {
    validateWorkspaceRefNode(node, depth, catalog);
    return;
  }
  if (isSegmentGroup(node)) {
    validateGroupNode(node, depth, catalog);
    return;
  }
  validateLeafCondition(node, catalog);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The conditions of a segment, from the JSON string or the object a client
 * sends, checked against the field catalogs. An empty value is an empty AND
 * group, which matches nobody.
 */
export function parseSegmentConditions(raw: unknown): SegmentConditionGroup {
  if (raw === undefined || raw === null || raw === "") {
    return { logical: "and", conditions: [] };
  }
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  assert(
    !!parsed && typeof parsed === "object" && isSegmentGroup(parsed as never),
    HTTP_BAD_REQUEST,
    `${ERRORS}.invalid_conditions`,
  );
  const group = parsed as SegmentConditionGroup;
  validateConditionNode(group, ROOT_DEPTH, "user");
  return group;
}

function parseText(value: unknown, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  assert(text.length <= maxLength, HTTP_BAD_REQUEST, `${ERRORS}.too_long`);
  return text;
}

function parseName(value: unknown): string {
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

const PATCH_PARSERS: {
  [Key in keyof SegmentInput]: (value: unknown) => SegmentInput[Key];
} = {
  name: parseName,
  description: (value) => parseText(value, DESCRIPTION_MAX_LENGTH),
  conditions: parseSegmentConditions,
};

/**
 * The fields an edit changes: only the ones the body carries, each checked
 * as on creation.
 */
export function parseSegmentPatch(
  body: SegmentInputBody,
): Partial<SegmentInput> {
  const patch: Partial<Record<keyof SegmentInput, unknown>> = {};
  for (const key of Object.keys(PATCH_PARSERS) as (keyof SegmentInput)[]) {
    if (body[key] === undefined) continue;
    patch[key] = PATCH_PARSERS[key](body[key]);
  }
  return patch as Partial<SegmentInput>;
}
