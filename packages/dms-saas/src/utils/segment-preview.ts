import type { SegmentConditionGroup } from "../db";
import {
  evaluateSegmentGroup,
  evaluateSegmentNode,
  isSegmentGroup,
  isSegmentWorkspaceRef,
  type SegmentNode,
  segmentWorkspacePool,
} from "./segment-evaluator";
import type { UserProjection } from "./segment-matching";

/** How many matching users a preview names. */
export const SEGMENT_PREVIEW_SAMPLE_SIZE = 5;

const PATH_SEPARATOR = ".";

/** A user a preview names among its matches. */
export interface SegmentPreviewUser {
  _id: string;
  name: string;
  email: string;
  /** A workspace of the user, owned ones first, to tell users apart. */
  workspaceName: string | null;
  /** The user matches the draft but not the saved version. */
  isAdded: boolean;
}

/** How many matching users one branch of an ANY group accounts for. */
export interface SegmentPreviewSignal {
  path: string;
  count: number;
}

/** What draft conditions would match, without saving them. */
export interface SegmentPreview {
  matchCount: number;
  totalUsers: number;
  /** Members of the saved version; null for a segment not saved yet. */
  savedCount: number | null;
  /** Matching users the saved version does not hold. */
  addedCount: number;
  /** Members of the saved version the draft no longer matches. */
  removedCount: number;
  /** Users each node matches on its own, by node path ("0", "1.2"). */
  nodeCounts: Record<string, number>;
  /** The branches of ANY groups, counted among the matching users. */
  signals: SegmentPreviewSignal[];
  /** Paths of the conditions every user matches: they narrow nothing. */
  universalPaths: string[];
  sample: SegmentPreviewUser[];
}

/** What a preview is computed from. */
export interface SegmentPreviewInputs {
  conditions: SegmentConditionGroup;
  users: readonly UserProjection[];
  /** Ids of the saved version's members; null for a new segment. */
  savedMemberIds: ReadonlySet<string> | null;
}

type Targets = (user: UserProjection) => Record<string, unknown>[];

interface PlacedNode {
  node: SegmentNode;
  path: string;
  targets: Targets;
  /** The node is a branch of an ANY group. */
  isSignal: boolean;
}

const asUserTarget: Targets = (user) => [user];

function childPath(parent: string, index: number): string {
  return parent ? `${parent}${PATH_SEPARATOR}${index}` : String(index);
}

function placeChildren(
  group: SegmentConditionGroup,
  parentPath: string,
  targets: Targets,
): PlacedNode[] {
  return group.conditions.flatMap((node, index) =>
    placeNode(
      node,
      childPath(parentPath, index),
      targets,
      group.logical === "or",
    ),
  );
}

function placeNode(
  node: SegmentNode,
  path: string,
  targets: Targets,
  isSignal: boolean,
): PlacedNode[] {
  const placed: PlacedNode = { node, path, targets, isSignal };
  if (isSegmentWorkspaceRef(node)) {
    const poolTargets: Targets = (user) => segmentWorkspacePool(node, user);
    return [placed, ...placeChildren(node.conditions, path, poolTargets)];
  }
  if (isSegmentGroup(node)) {
    return [placed, ...placeChildren(node, path, targets)];
  }
  return [placed];
}

function countMatching(
  entry: PlacedNode,
  users: readonly UserProjection[],
): number {
  return users.filter((user) =>
    entry
      .targets(user)
      .some((target) => evaluateSegmentNode(entry.node, target)),
  ).length;
}

function workspaceNameOf(user: UserProjection): string | null {
  const owned = user.workspaces.find((workspace) => workspace.isOwner);
  return (owned ?? user.workspaces[0])?.name ?? null;
}

function previewSample(
  matched: readonly UserProjection[],
  savedMemberIds: ReadonlySet<string> | null,
): SegmentPreviewUser[] {
  const isAdded = (user: UserProjection) =>
    savedMemberIds !== null && !savedMemberIds.has(user._id);
  return [...matched]
    .sort(
      (a, b) =>
        Number(isAdded(b)) - Number(isAdded(a)) ||
        (a.name || a.email).localeCompare(b.name || b.email),
    )
    .slice(0, SEGMENT_PREVIEW_SAMPLE_SIZE)
    .map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      workspaceName: workspaceNameOf(user),
      isAdded: isAdded(user),
    }));
}

function countRemoved(
  matchedIds: ReadonlySet<string>,
  savedMemberIds: ReadonlySet<string> | null,
): number {
  if (!savedMemberIds) return 0;
  return [...savedMemberIds].filter((id) => !matchedIds.has(id)).length;
}

/**
 * Evaluate draft conditions over every user: how many match, the change
 * against the saved version, how many each condition matches on its own,
 * which branch of an ANY group the matches come from, and a few of them.
 */
export function computeSegmentPreview(
  inputs: SegmentPreviewInputs,
): SegmentPreview {
  const { conditions, users, savedMemberIds } = inputs;
  const matched = users.filter((user) =>
    evaluateSegmentGroup(conditions, user),
  );
  const matchedIds = new Set(matched.map((user) => user._id));
  const placed = placeChildren(conditions, "", asUserTarget);
  const nodeCounts = Object.fromEntries(
    placed.map((entry) => [entry.path, countMatching(entry, users)]),
  );
  return {
    matchCount: matched.length,
    totalUsers: users.length,
    savedCount: savedMemberIds ? savedMemberIds.size : null,
    addedCount: savedMemberIds
      ? matched.filter((user) => !savedMemberIds.has(user._id)).length
      : matched.length,
    removedCount: countRemoved(matchedIds, savedMemberIds),
    nodeCounts,
    signals: placed
      .filter((entry) => entry.isSignal)
      .map((entry) => ({
        path: entry.path,
        count: countMatching(entry, matched),
      })),
    universalPaths: placed
      .filter(
        (entry) =>
          entry.targets === asUserTarget &&
          users.length > 0 &&
          nodeCounts[entry.path] === users.length,
      )
      .map((entry) => entry.path),
    sample: previewSample(matched, savedMemberIds),
  };
}
