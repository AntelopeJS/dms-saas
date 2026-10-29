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

/** Whether a node is a group of conditions joined by AND / OR. */
export function isSegmentGroup(
  node: SegmentNode,
): node is SegmentConditionGroup {
  return (node as SegmentConditionGroup).logical !== undefined;
}

/** Whether a node is a condition on the user's workspaces. */
export function isSegmentWorkspaceRef(
  node: SegmentNode,
): node is SegmentWorkspaceRef {
  return (node as SegmentWorkspaceRef).kind === "workspaceRef";
}

function getFieldValue(target: Record<string, unknown>, path: string): unknown {
  if (path in target) return target[path];
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && isObjectOrNull(acc)
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      target,
    );
}

const KIND_COERCERS: Record<SegmentValueKind, (value: unknown) => unknown> = {
  number: (value) => {
    if (isNumber(value)) return value;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  },
  boolean: (value) => {
    if (isBoolean(value)) return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  },
  date: (value) =>
    value instanceof Date ? value.getTime() : new Date(String(value)).getTime(),
  string: (value) => (isString(value) ? value : String(value)),
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
  if (isNumber(a) && isNumber(e)) return a - e;
  if (isString(a) && isString(e)) return a.localeCompare(e);
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
  if (isString(actual) && isString(expected)) {
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
 * The workspaces a workspaceRef node reads on a user projection: the ones
 * listed under `workspaces`, only the owned ones (`isOwner`) for
 * `role: "owner"`.
 */
export function segmentWorkspacePool(
  node: SegmentWorkspaceRef,
  target: Record<string, unknown>,
): Record<string, unknown>[] {
  const all = Array.isArray(target.workspaces)
    ? (target.workspaces as Record<string, unknown>[])
    : [];
  return node.role === "owner" ? all.filter((w) => w.isOwner === true) : all;
}

/**
 * Evaluate a workspaceRef node against a user projection. `role: "owner"`
 * restricts the pool to owned workspaces before the quantifier applies; an
 * empty pool never matches, whatever the quantifier.
 */
function evaluateWorkspaceRef(
  node: SegmentWorkspaceRef,
  target: Record<string, unknown>,
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
  target: Record<string, unknown>,
): boolean {
  if (isSegmentWorkspaceRef(node)) return evaluateWorkspaceRef(node, target);
  if (isSegmentGroup(node)) return evaluateSegmentGroup(node, target);
  return evaluateCondition(node, target);
}

export function evaluateSegmentGroup(
  group: SegmentConditionGroup | null | undefined,
  target: Record<string, unknown>,
): boolean {
  if (!group?.conditions?.length) return false;
  const results = group.conditions.map((node) =>
    evaluateSegmentNode(node, target),
  );
  return group.logical === "or"
    ? results.some(Boolean)
    : results.every(Boolean);
}
