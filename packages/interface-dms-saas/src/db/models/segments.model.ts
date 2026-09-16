import { randomUUID } from "node:crypto";
import {
  BasicDataModel,
  type DeepPartial,
  triggerEvent,
  type ValidateOptions,
} from "@antelopejs/interface-database-decorators";
import { Segment, segmentsTableName } from "../tables/segments.table";

/** Data access for reusable audience segments. */
export class SegmentModel extends BasicDataModel(Segment, segmentsTableName) {
  /** New segments start with an explicit revision on every supported backend. */
  override insert(
    rows: DeepPartial<Segment> | DeepPartial<Segment>[],
    options?: ValidateOptions,
  ): Promise<string[]> {
    const initialize = (row: DeepPartial<Segment>): DeepPartial<Segment> => ({
      ...row,
      revision: randomUUID(),
    });
    return super.insert(
      Array.isArray(rows) ? rows.map(initialize) : initialize(rows),
      options,
    );
  }

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
  async update(
    idOrPatch: string | DeepPartial<Segment>,
    patchOrOptions?: DeepPartial<Segment> | ValidateOptions,
    options?: ValidateOptions,
  ): Promise<number> {
    const id = typeof idOrPatch === "string" ? idOrPatch : idOrPatch._id;
    if (!id) throw new Error("Segment identity is required");
    return this.updateRevision(
      id,
      typeof idOrPatch === "string"
        ? (patchOrOptions as DeepPartial<Segment>)
        : idOrPatch,
      typeof idOrPatch === "string"
        ? options
        : (patchOrOptions as ValidateOptions),
    );
  }

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
    const outcome = await this.table
      .atomicMutation(id, {
        type: "update",
        revisionField: "revision",
        expectedRevision:
          current.revision === undefined
            ? { kind: "missing" }
            : current.revision,
        nextRevision: randomUUID(),
        patch: SegmentModel.toDatabase(instance),
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
  ): Promise<boolean> {
    const outcome = await this.table
      .atomicMutation(segment._id, {
        type: "update",
        revisionField: "revision",
        expectedRevision:
          segment.revision === undefined
            ? { kind: "missing" }
            : segment.revision,
        nextRevision: randomUUID(),
        patch: {
          membershipGeneration: generation,
          estimatedCount: count,
          lastEvaluatedAt: evaluatedAt,
          updatedAt: evaluatedAt,
        },
      })
      .run();
    if (outcome === "unknown")
      throw new Error("Segment publication outcome is unknown");
    return outcome === "applied";
  }

  async getMany(ids: readonly string[]): Promise<Segment[]> {
    if (ids.length === 0) return [];
    const rows = await this.table.getAll(ids as string[]).run();
    return rows
      .map((row) => SegmentModel.fromDatabase(row))
      .filter((s): s is Segment => s !== undefined);
  }
}
