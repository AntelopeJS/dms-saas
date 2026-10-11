import type {
  SegmentCondition,
  SegmentConditionGroup,
  SegmentWorkspaceRef,
} from "../db";
import {
  evaluateSegmentNode,
  isSegmentGroup,
  isSegmentWorkspaceRef,
  type SegmentNode,
  segmentWorkspacePool,
} from "./segment-evaluator";

/** A workspace condition, with the workspaces of the user that meet it. */
export interface ExplainedWorkspaceRef extends Omit<
  SegmentWorkspaceRef,
  "conditions"
> {
  conditions: ExplainedGroup;
  /** Names of the user's workspaces meeting the nested conditions. */
  workspaceNames: string[];
}

/** A group keeping only the branches a user meets. */
export interface ExplainedGroup extends Omit<
  SegmentConditionGroup,
  "conditions"
> {
  conditions: ExplainedNode[];
}

/** One node of the rules a user meets. */
export type ExplainedNode =
  | SegmentCondition
  | ExplainedGroup
  | ExplainedWorkspaceRef;

function explainWorkspaceRef(
  node: SegmentWorkspaceRef,
  target: Record<string, unknown>,
): ExplainedWorkspaceRef {
  const meeting = segmentWorkspacePool(node, target).filter((workspace) =>
    evaluateSegmentNode(node.conditions, workspace),
  );
  const [first] = meeting;
  return {
    ...node,
    conditions: first
      ? explainSegmentGroup(node.conditions, first)
      : { ...node.conditions, conditions: [] },
    workspaceNames: meeting.map((workspace) =>
      typeof workspace.name === "string" ? workspace.name : "",
    ),
  };
}

function explainNode(
  node: SegmentNode,
  target: Record<string, unknown>,
): ExplainedNode {
  if (isSegmentWorkspaceRef(node)) return explainWorkspaceRef(node, target);
  if (isSegmentGroup(node)) return explainSegmentGroup(node, target);
  return node;
}

/**
 * The rules a projection meets, read as why it belongs to the segment: an
 * ANY group keeps only the branches the projection meets, and a workspace
 * condition names the workspaces meeting it. Meant for a projection the
 * group matches; for one it does not, branches it fails stay out.
 */
export function explainSegmentGroup(
  group: SegmentConditionGroup,
  target: Record<string, unknown>,
): ExplainedGroup {
  return {
    logical: group.logical,
    conditions: group.conditions
      .filter((node) => evaluateSegmentNode(node, target))
      .map((node) => explainNode(node, target)),
  };
}
