import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentOperator,
  SegmentWorkspaceRef,
} from "../db";
import { findAnySegmentField, type SegmentValueKind } from "./segment-fields";

export type SegmentNode =
  | SegmentCondition
  | SegmentConditionGroup
  | SegmentWorkspaceRef;

type FieldKind = SegmentValueKind | "unknown";

function isGroup(node: SegmentNode): node is SegmentConditionGroup {
  return (node as SegmentConditionGroup).logical !== undefined;
}

function isWorkspaceRef(node: SegmentNode): node is SegmentWorkspaceRef {
  return (node as SegmentWorkspaceRef).kind === "workspaceRef";
}

function getFieldValue(target: Record<string, unknown>, path: string): unknown {
  if (path in target) return target[path];
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      target,
    );
}

const KIND_COERCERS: Record<SegmentValueKind, (value: unknown) => unknown> = {
  number: (value) => {
    if (typeof value === "number") return value;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  },
  boolean: (value) => {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  },
  date: (value) =>
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime(),
  string: (value) => (typeof value === "string" ? value : String(value)),
};

function coerce(value: unknown, kind: FieldKind): unknown {
  if (value === null || value === undefined || kind === "unknown") return value;
  return KIND_COERCERS[kind](value);
}

function getKind(fieldId: string): FieldKind {
  return findAnySegmentField(fieldId)?.valueKind ?? "unknown";
}

function compareValues(
  actual: unknown,
  expected: unknown,
  kind: FieldKind,
): number | null {
  const a = coerce(actual, kind);
  const e = coerce(expected, kind);
  if (typeof a === "number" && typeof e === "number") return a - e;
  if (typeof a === "string" && typeof e === "string") return a.localeCompare(e);
  return null;
}

function equals(actual: unknown, expected: unknown, kind: FieldKind): boolean {
  return coerce(actual, kind) === coerce(expected, kind);
}

function comparesWith(
  actual: unknown,
  expected: unknown,
  kind: FieldKind,
  predicate: (comparison: number) => boolean,
): boolean {
  const comparison = compareValues(actual, expected, kind);
  return comparison !== null && predicate(comparison);
}

function evaluateContains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.toLowerCase().includes(expected.toLowerCase());
  }
  if (Array.isArray(actual)) return actual.includes(expected);
  return false;
}

type OperatorHandler = (
  actual: unknown,
  expected: unknown,
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
    Array.isArray(expected) &&
    expected.some((value) => equals(actual, value, kind)),
  nin: (actual, expected, kind) =>
    Array.isArray(expected) &&
    !expected.some((value) => equals(actual, value, kind)),
  contains: (actual, expected) => evaluateContains(actual, expected),
};

function evaluateCondition(
  condition: SegmentCondition,
  target: Record<string, unknown>,
): boolean {
  const handler = OPERATOR_HANDLERS[condition.operator];
  if (!handler) return false;
  const actual = getFieldValue(target, condition.field);
  return handler(actual, condition.value, getKind(condition.field));
}

/**
 * Evaluate a workspaceRef node against a user projection: the projection must
 * expose its workspaces under `workspaces`, each entry carrying an `isOwner`
 * flag. `role: "owner"` restricts the pool to owned workspaces before the
 * quantifier applies; an empty pool never matches, whatever the quantifier.
 */
function evaluateWorkspaceRef(
  node: SegmentWorkspaceRef,
  target: Record<string, unknown>,
): boolean {
  const all = Array.isArray(target.workspaces)
    ? (target.workspaces as Record<string, unknown>[])
    : [];
  const workspaces =
    node.role === "owner" ? all.filter((w) => w.isOwner === true) : all;
  if (workspaces.length === 0) return false;
  return node.quantifier === "all"
    ? workspaces.every((w) => evaluateSegmentGroup(node.conditions, w))
    : workspaces.some((w) => evaluateSegmentGroup(node.conditions, w));
}

function evaluateNode(
  node: SegmentNode,
  target: Record<string, unknown>,
): boolean {
  if (isWorkspaceRef(node)) return evaluateWorkspaceRef(node, target);
  if (isGroup(node)) return evaluateSegmentGroup(node, target);
  return evaluateCondition(node, target);
}

export function evaluateSegmentGroup(
  group: SegmentConditionGroup | null | undefined,
  target: Record<string, unknown>,
): boolean {
  if (!group?.conditions?.length) return false;
  const results = group.conditions.map((node) => evaluateNode(node, target));
  return group.logical === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}
