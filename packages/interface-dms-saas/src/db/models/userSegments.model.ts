import { createHash, randomUUID } from "node:crypto";
import {
  BasicDataModel,
  GetModel,
} from "@antelopejs/interface-database-decorators";
import type { Segment } from "../tables/segments.table";
import { SegmentModel } from "./segments.model";
import {
  UserSegment,
  userSegmentsTableName,
} from "../tables/userSegments.table";

const SNAPSHOT_ATTEMPTS = 3;

function sameGenerations(before: Segment[], after: Segment[]): boolean {
  const current = new Map(
    after.map((segment) => [segment._id, segment.membershipGeneration]),
  );
  return (
    before.length === after.length &&
    before.every(
      (segment) =>
        current.has(segment._id) &&
        current.get(segment._id) === segment.membershipGeneration,
    )
  );
}

/** Data access for materialized user segment memberships. */
export class UserSegmentModel extends BasicDataModel(
  UserSegment,
  userSegmentsTableName,
) {
  async listByUser(userId: string): Promise<UserSegment[]> {
    const segments = GetModel(SegmentModel);
    for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
      const before = await segments.getAll();
      const rows = await this.getBy("userId", userId);
      if (!sameGenerations(before, await segments.getAll())) continue;
      const published = new Map(
        before.map((segment) => [segment._id, segment.membershipGeneration]),
      );
      return rows.filter(
        (row) =>
          published.has(row.segmentId) &&
          row.generation === published.get(row.segmentId),
      );
    }
    throw new Error("Segment publication changed while reading memberships");
  }

  async listBySegment(segmentId: string): Promise<UserSegment[]> {
    const segments = GetModel(SegmentModel);
    for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
      const before = await segments.get(segmentId);
      if (!before) return [];
      const rows = await this.getBy("segmentId", segmentId);
      const after = await segments.get(segmentId);
      if (!after || before.membershipGeneration !== after.membershipGeneration)
        continue;
      return rows.filter(
        (row) => row.generation === before.membershipGeneration,
      );
    }
    throw new Error("Segment publication changed while reading memberships");
  }

  async countBySegment(segmentId: string): Promise<number> {
    return (await this.listBySegment(segmentId)).length;
  }

  /** Writes an immutable generation before atomically publishing its pointer and count. */
  async replaceForSegment(
    segment: Segment,
    userIds: readonly string[],
    evaluatedAt: Date,
  ): Promise<void> {
    const generation = randomUUID();
    const members = [...new Set(userIds)];
    if (members.length > 0) {
      await this.insert(
        members.map((userId) => {
          const membership: UserSegment = {
            _id: createHash("sha256")
              .update(JSON.stringify([generation, userId]))
              .digest("hex"),
            userId,
            segmentId: segment._id,
            evaluatedAt,
            generation,
            revision: randomUUID(),
          };
          if (segment.revision !== undefined)
            membership.sourceRevision = segment.revision;
          return membership;
        }),
      );
    }
    await GetModel(SegmentModel).publishMemberships(
      segment,
      generation,
      members.length,
      evaluatedAt,
    );
    await this.cleanupUnpublishable(segment._id);
  }

  /** A candidate is collectible only once its source revision can no longer publish. */
  async cleanupUnpublishable(segmentId: string): Promise<void> {
    const rows = await this.getBy("segmentId", segmentId);
    const current = await GetModel(SegmentModel).get(segmentId);
    for (const row of rows) {
      if (
        current &&
        (row.generation === current.membershipGeneration ||
          row.sourceRevision === current.revision)
      )
        continue;
      await this.deleteMembership(row);
    }
  }

  private async deleteMembership(row: UserSegment): Promise<void> {
    const outcome = await this.table
      .atomicMutation(row._id, {
        type: "delete",
        revisionField: "revision",
        expectedRevision:
          row.revision === undefined ? { kind: "missing" } : row.revision,
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Membership deletion outcome is unknown");
  }

  async deleteAllForUser(userId: string): Promise<void> {
    for (const row of await this.getBy("userId", userId))
      await this.deleteMembership(row);
  }
}
