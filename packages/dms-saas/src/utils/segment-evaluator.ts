import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentOperator,
  SegmentWorkspaceRef,
} from "../db";
import { findAnySegmentField, type SegmentValueKind } from "./segment-fields";
import {
  isBoolean,
  isNumber,
  isObjectOrNull,
  isString,
} from "./primitive-guards";

export type SegmentNode =
  | SegmentCondition
  | SegmentConditionGroup
  | SegmentWorkspaceRef;

type FieldKind = SegmentValueKind | "unknown";

/** A value to compare, held like a condition holds what it expects. */
type Operand = Pick<SegmentCondition, "value">;

/** A value a segment projection holds: a scalar, a date, or its workspaces. */
export type ProjectionValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ProjectionRecord
  | ProjectionRecord[];

/** A projection of a user or of a workspace, read by field path. */
export type ProjectionRecord = { [field: string]: ProjectionValue };

/** Whether a node is a group of conditions joined by AND / OR. */
export function isSegmentGroup(
  node: SegmentNode,
): node is SegmentConditionGroup {
  return (
    isObjectOrNull(node) &&
    node !== null &&
    "logical" in node &&
    node.logical !== undefined
  );
}

/** Whether a node is a condition on the user's workspaces. */
export function isSegmentWorkspaceRef(
  node: SegmentNode,
): node is SegmentWorkspaceRef {
  return (
    isObjectOrNull(node) &&
    node !== null &&
    "kind" in node &&
    node.kind === "workspaceRef"
  );
}

function getFieldValue(
  target: ProjectionRecord,
  path: string,
): ProjectionValue {
  if (Object.hasOwn(target, path)) return target[path];
  return path
    .split(".")
    .reduce<ProjectionValue>(
      (acc, key) =>
        acc &&
        isObjectOrNull(acc) &&
        !(acc instanceof Date) &&
        !Array.isArray(acc)
          ? acc[key]
          : undefined,
      target,
    );
}

const KIND_COERCERS: Record<SegmentValueKind, (operand: Operand) => Operand> = {
  number: ({ value }) => {
    if (isNumber(value)) return { value };
    const parsed = Number(value);
    return { value: Number.isNaN(parsed) ? undefined : parsed };
  },
  boolean: ({ value }) => {
    if (isBoolean(value)) return { value };
    if (value === "true") return { value: true };
    if (value === "false") return { value: false };
    return { value: undefined };
  },
  date: ({ value }) => ({
    value:
      value instanceof Date
        ? value.getTime()
        : new Date(String(value)).getTime(),
  }),
  string: ({ value }) => ({ value: isString(value) ? value : String(value) }),
};

function coerce(operand: Operand, kind: FieldKind): Operand {
  const { value } = operand;
  if (value === null || value === undefined || kind === "unknown") {
    return operand;
  }
  return KIND_COERCERS[kind](operand);
}

function getKind(fieldId: string): FieldKind {
  return findAnySegmentField(fieldId)?.valueKind ?? "unknown";
}

function compareValues(
  actual: ProjectionValue,
  expected: Operand,
  kind: FieldKind,
): number | null {
  const a = coerce({ value: actual }, kind).value;
  const e = coerce(expected, kind).value;
  if (isNumber(a) && isNumber(e)) return a - e;
  if (isString(a) && isString(e)) return a.localeCompare(e);
  return null;
}

function equals(
  actual: ProjectionValue,
  expected: Operand,
  kind: FieldKind,
): boolean {
  return coerce({ value: actual }, kind).value === coerce(expected, kind).value;
}

function comparesWith(
  actual: ProjectionValue,
  expected: Operand,
  kind: FieldKind,
  predicate: (comparison: number) => boolean,
): boolean {
  const comparison = compareValues(actual, expected, kind);
  return comparison !== null && predicate(comparison);
}

function evaluateContains(actual: ProjectionValue, expected: Operand): boolean {
  if (isString(actual) && isString(expected.value)) {
    return actual.toLowerCase().includes(expected.value.toLowerCase());
  }
  if (Array.isArray(actual)) {
    const items: readonly unknown[] = actual;
    return items.includes(expected.value);
  }
  return false;
}

type OperatorHandler = (
  actual: ProjectionValue,
  expected: Operand,
  kind: FieldKind,
) => boolean;

const OPERATOR_HANDLERS: Record<SegmentOperator, OperatorHandler> = {
  eq: (actual, expected, kind) => equals(actual, expected, kind),
  neq: (actual, expected, kind) => !equals(actual, expected, kind),
  gt: (actual, expected, kind) =>
    comparesWith(actual, expected, kind, (c) => c > 0),
  gte: (actual, expected, kind) =>
    comparesWith(actual, expected, kind, (c) => c >= 0),
  lt: (actual, expected, kind) =>
    comparesWith(actual, expected, kind, (c) => c < 0),
  lte: (actual, expected, kind) =>
    comparesWith(actual, expected, kind, (c) => c <= 0),
  in: (actual, expected, kind) =>
    Array.isArray(expected.value) &&
    expected.value.some((value) => equals(actual, { value }, kind)),
  nin: (actual, expected, kind) =>
    Array.isArray(expected.value) &&
    !expected.value.some((value) => equals(actual, { value }, kind)),
  contains: (actual, expected) => evaluateContains(actual, expected),
};

function evaluateCondition(
  condition: SegmentCondition,
  target: ProjectionRecord,
): boolean {
  const handler = OPERATOR_HANDLERS[condition.operator];
  if (!handler) return false;
  const actual = getFieldValue(target, condition.field);
  return handler(actual, condition, getKind(condition.field));
}

/**
 * The workspaces a workspaceRef node reads on a user projection: the ones
 * listed under `workspaces`, only the owned ones (`isOwner`) for
 * `role: "owner"`.
 */
export function segmentWorkspacePool(
  node: SegmentWorkspaceRef,
  target: ProjectionRecord,
): ProjectionRecord[] {
  const { workspaces } = target;
  const all = Array.isArray(workspaces) ? workspaces : [];
  return node.role === "owner" ? all.filter((w) => w.isOwner === true) : all;
}

/**
 * Evaluate a workspaceRef node against a user projection. `role: "owner"`
 * restricts the pool to owned workspaces before the quantifier applies; an
 * empty pool never matches, whatever the quantifier.
 */
function evaluateWorkspaceRef(
  node: SegmentWorkspaceRef,
  target: ProjectionRecord,
): boolean {
  const workspaces = segmentWorkspacePool(node, target);
  if (workspaces.length === 0) return false;
  return node.quantifier === "all"
    ? workspaces.every((w) => evaluateSegmentGroup(node.conditions, w))
    : workspaces.some((w) => evaluateSegmentGroup(node.conditions, w));
}

/** Evaluate any node of a segment's tree against a projection. */
export function evaluateSegmentNode(
  node: SegmentNode,
  target: ProjectionRecord,
): boolean {
  if (isSegmentWorkspaceRef(node)) return evaluateWorkspaceRef(node, target);
  if (isSegmentGroup(node)) return evaluateSegmentGroup(node, target);
  return evaluateCondition(node, target);
}

export function evaluateSegmentGroup(
  group: SegmentConditionGroup | null | undefined,
  target: ProjectionRecord,
): boolean {
  if (!group?.conditions?.length) return false;
  const results = group.conditions.map((node) =>
    evaluateSegmentNode(node, target),
  );
  return group.logical === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}
