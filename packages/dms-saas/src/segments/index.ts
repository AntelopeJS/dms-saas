import { assert } from "@antelopejs/interface-api-util";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  PlanModel,
  type Segment,
  type SegmentConditionGroup,
  SegmentModel,
  UserSegmentModel,
} from "../db";
import {
  computeSegmentPreview,
  invalidateSegmentNamesCache,
  loadAllUserProjections,
  recomputeSegmentsByIds,
  type SegmentInput,
  type SegmentPreview,
} from "../utils";

const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const NOT_FOUND = "saas.errors.segments.not_found";
const DUPLICATE_SUFFIX = " (copy)";

/** A segment as its editor loads it. */
export interface SegmentDraft {
  _id: string;
  name: string;
  description: string;
  conditions: SegmentConditionGroup;
  estimatedCount: number;
  lastEvaluatedAt: Date | null;
  lastEvaluationMs: number | null;
  updatedAt: Date;
}

/** Where a segment stands after it was saved or re-evaluated. */
export interface SegmentEvaluation {
  _id: string;
  estimatedCount: number;
  lastEvaluatedAt: Date | null;
  /** The evaluation failed: the segment keeps its previous members. */
  evaluationFailed: boolean;
}

/** A draft's preview, timed. */
export interface TimedSegmentPreview extends SegmentPreview {
  /** When the saved version's members were last evaluated. */
  savedEvaluatedAt: Date | null;
  evaluatedAt: Date;
  durationMs: number;
}

async function requireSegment(id: string): Promise<Segment> {
  const segment = await GetModel(SegmentModel).get(id);
  assert(segment, HTTP_NOT_FOUND, NOT_FOUND);
  return segment;
}

/** The segment as its editor loads it. */
export async function loadSegmentDraft(id: string): Promise<SegmentDraft> {
  const segment = await requireSegment(id);
  return {
    _id: segment._id,
    name: segment.name,
    description: segment.description ?? "",
    conditions: segment.conditions,
    estimatedCount: segment.estimatedCount ?? 0,
    lastEvaluatedAt: segment.lastEvaluatedAt ?? null,
    lastEvaluationMs: segment.lastEvaluationMs ?? null,
    updatedAt: segment.updatedAt,
  };
}

/**
 * Evaluate the segment now and publish its members. A failure is logged and
 * reported, never thrown: the segment keeps its previous members, and the
 * nightly run tries again.
 */
export async function evaluateSegment(id: string): Promise<SegmentEvaluation> {
  let evaluationFailed = false;
  try {
    await recomputeSegmentsByIds([id]);
  } catch (error) {
    evaluationFailed = true;
    Logging.Error("[dms-saas] segment evaluation failed", error);
  }
  const segment = await requireSegment(id);
  return {
    _id: id,
    estimatedCount: segment.estimatedCount ?? 0,
    lastEvaluatedAt: segment.lastEvaluatedAt ?? null,
    evaluationFailed,
  };
}

/** Create a segment and evaluate it. */
export async function createSegment(
  input: SegmentInput,
): Promise<SegmentEvaluation> {
  const [id] = await GetModel(SegmentModel).insert({
    ...input,
    estimatedCount: 0,
    lastEvaluatedAt: null,
    countHistory: [],
  });
  assert(id, HTTP_CONFLICT, "saas.errors.segments.edit_conflict");
  invalidateSegmentNamesCache();
  return evaluateSegment(id);
}

/**
 * Save a segment's rules and evaluate them. The save is refused when the
 * segment changed since it was read (an edit racing another one).
 */
export async function saveSegment(
  id: string,
  input: Partial<SegmentInput>,
): Promise<SegmentEvaluation> {
  await requireSegment(id);
  try {
    await GetModel(SegmentModel).update(id, input);
  } catch (error) {
    Logging.Warn("[dms-saas] segment save refused", error);
    assert(false, HTTP_CONFLICT, "saas.errors.segments.edit_conflict");
  }
  invalidateSegmentNamesCache();
  return evaluateSegment(id);
}

/** Copy a segment, rules included, and evaluate the copy. */
export async function duplicateSegment(id: string): Promise<SegmentEvaluation> {
  const source = await requireSegment(id);
  return createSegment({
    name: `${source.name}${DUPLICATE_SUFFIX}`,
    description: source.description ?? "",
    conditions: source.conditions,
  });
}

interface SavedVersion {
  memberIds: ReadonlySet<string>;
  evaluatedAt: Date | null;
}

async function loadSavedVersion(
  segmentId: string | undefined,
): Promise<SavedVersion | null> {
  if (!segmentId) return null;
  const segment = await GetModel(SegmentModel).get(segmentId);
  if (!segment) return null;
  const links = await GetModel(UserSegmentModel).listBySegment(segmentId);
  return {
    memberIds: new Set(links.map((link) => link.userId)),
    evaluatedAt: segment.lastEvaluatedAt ?? null,
  };
}

/**
 * What draft conditions would match, compared with the saved version of
 * `segmentId` when given. Nothing is saved.
 */
export async function previewSegment(
  conditions: SegmentConditionGroup,
  segmentId?: string,
): Promise<TimedSegmentPreview> {
  const startedAt = performance.now();
  const evaluatedAt = new Date();
  const [users, saved] = await Promise.all([
    loadAllUserProjections(GetModel(PlanModel), evaluatedAt),
    loadSavedVersion(segmentId),
  ]);
  const preview = computeSegmentPreview({
    conditions,
    users,
    savedMemberIds: saved?.memberIds ?? null,
  });
  return {
    ...preview,
    savedEvaluatedAt: saved?.evaluatedAt ?? null,
    evaluatedAt,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
