import { randomUUID } from "node:crypto";
import {
  BasicDataModel,
  type DeepPartial,
  triggerEvent,
  type ValidateOptions,
} from "@antelopejs/interface-database-decorators";
import {
  Segment,
  type SegmentCountPoint,
  segmentsTableName,
} from "../tables/segments.table";

/** Days of counts a segment keeps for its trend. */
export const SEGMENT_COUNT_HISTORY_DAYS = 30;

const ISO_DAY_LENGTH = 10;

/** What an evaluation measured besides the members it found. */
export interface SegmentEvaluationStats {
  /** How long the evaluation took, in milliseconds. */
  durationMs?: number;
}

/**
 * The count history with the evaluation of `evaluatedAt` recorded: one point
 * per UTC day (the latest evaluation of a day wins), the last
 * {@link SEGMENT_COUNT_HISTORY_DAYS} days kept.
 */
export function appendSegmentCountPoint(
  history: readonly SegmentCountPoint[],
  count: number,
  evaluatedAt: Date,
): SegmentCountPoint[] {
  const day = evaluatedAt.toISOString().slice(0, ISO_DAY_LENGTH);
  const kept = history.filter((point) => point.day !== day);
  return [...kept, { day, count }]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-SEGMENT_COUNT_HISTORY_DAYS);
}

type KeyedSegmentUpdate = [
  id: string,
  patch: DeepPartial<Segment>,
  options?: ValidateOptions,
];

type SegmentUpdateArguments =
  | KeyedSegmentUpdate
  | [patch: DeepPartial<Segment>, options?: ValidateOptions];

/** Data access for reusable audience segments. */
export class SegmentModel extends BasicDataModel(Segment, segmentsTableName) {
  /** Every edit invalidates computations based on the previous conditions. */
  async update(
    id: string,
    patch: DeepPartial<Segment>,
    options?: ValidateOptions,
  ): Promise<number>;
  async update(
    patch: DeepPartial<Segment>,
    options?: ValidateOptions,
  ): Promise<number>;
  async update(...args: SegmentUpdateArguments): Promise<number> {
    const [id, patch, options] = isKeyedUpdate(args)
      ? args
      : [args[0]._id, args[0], args[1]];
    if (!id) throw new Error("Segment identity is required");
    return this.updateRevision(id, patch, options);
  }

  /**
   * Applies `patch` as a compare-and-set on the stored revision, which owns
   * the next revision rather than the update modifier.
   */
  private async updateRevision(
    id: string,
    patch: DeepPartial<Segment>,
    options?: ValidateOptions,
  ): Promise<number> {
    if (
      options?.validate &&
      !SegmentModel.validate(patch, { partial: true }).ok
    )
      throw new Error("Invalid segment patch");
    const current = await this.get(id);
    if (!current) return 0;
    const { _id, revision, ...changes } = patch;
    const instance = SegmentModel.fromPlainData(changes);
    triggerEvent(instance, "update");
    const { revision: _rotated, ...dbPatch } =
      SegmentModel.toDatabase(instance);
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: current.revision,
        nextRevision: randomUUID(),
        patch: dbPatch,
      })
      .run();
    if (outcome !== "applied")
      throw new Error(`Segment edit ${outcome}; reload before retry`);
    return 1;
  }

  /** Publishes the pointer and count only while the source revision is unchanged. */
  async publishMemberships(
    segment: Segment,
    generation: string,
    count: number,
    evaluatedAt: Date,
    stats: SegmentEvaluationStats = {},
  ): Promise<boolean> {
    const outcome = await this.table
      .atomicMutation(segment._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision: segment.revision,
        nextRevision: randomUUID(),
        patch: {
          membershipGeneration: generation,
          estimatedCount: count,
          lastEvaluatedAt: evaluatedAt,
          lastEvaluationMs: stats.durationMs ?? null,
          countHistory: appendSegmentCountPoint(
            segment.countHistory,
            count,
            evaluatedAt,
          ),
        },
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Segment publication outcome is unknown");
    return outcome === "applied";
  }

  async getMany(ids: readonly string[]): Promise<Segment[]> {
    if (ids.length === 0) return [];
    const rows = await this.table.getAll([...ids]).run();
    return rows
      .map((row) => SegmentModel.fromDatabase(row))
      .filter((s): s is Segment => s !== undefined);
  }
}

function isKeyedUpdate(
  args: SegmentUpdateArguments,
): args is KeyedSegmentUpdate {
  return typeof args[0] === "string";
}
