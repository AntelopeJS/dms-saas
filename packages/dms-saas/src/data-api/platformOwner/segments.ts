import { Controller, type RequestContext } from "@antelopejs/interface-api";
import {
  DataController,
  type DataControllerCallback,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  type CellSubline,
  type CellTone,
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import {
  Segment,
  type SegmentConditionGroup,
  type SegmentCountPoint,
  SegmentModel,
  UserSegmentModel,
} from "../../db";
import { composed } from "../../i18n/composed-text";
import {
  invalidateSegmentNamesCache,
  MS_PER_DAY,
  SegmentConditionsType,
} from "../../utils";

const SEGMENTS_API_BASE = "/api/saas/segments";
const CHANGE_WINDOW_DAYS = 7;
const ISO_DAY_LENGTH = 10;
const RULES_COLUMN_SIZE = 420;
const NAME_COLUMN_SIZE = 240;

interface DeleteParams {
  id: string | string[];
}

interface SegmentRowInstance {
  table: Pick<Segment, "countHistory" | "estimatedCount">;
}

function rowOf(self: unknown): SegmentRowInstance["table"] {
  return (self as SegmentRowInstance).table;
}

function historyOf(self: unknown): SegmentCountPoint[] {
  return rowOf(self).countHistory ?? [];
}

function dayBefore(days: number, now: Date): string {
  return new Date(now.getTime() - days * MS_PER_DAY)
    .toISOString()
    .slice(0, ISO_DAY_LENGTH);
}

/**
 * The change of the count over the last week: the current count minus the
 * last one recorded a week ago or earlier, or the oldest one when the
 * history is shorter. Zero without any history.
 */
export function weeklyCountChange(
  history: readonly SegmentCountPoint[],
  currentCount: number,
  now: Date = new Date(),
): number {
  const cutoff = dayBefore(CHANGE_WINDOW_DAYS, now);
  const reference =
    history.filter((point) => point.day <= cutoff).at(-1) ?? history[0];
  return reference ? currentCount - reference.count : 0;
}

type ChangeDirection = "up" | "down" | "flat";

const WEEKLY_CHANGE_KEY = "saas.segments.weekly_change";
const CHANGE_TONES: Record<ChangeDirection, CellTone> = {
  up: "success",
  down: "error",
  flat: "dimmed",
};

function changeDirection(change: number): ChangeDirection {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}

/** "▲ +4 this week" in green, "▼ -2 this week" in red, "— 0 this week" dimmed. */
export function weeklyChangeLine(change: number): CellSubline {
  const direction = changeDirection(change);
  return {
    text: composed(`${WEEKLY_CHANGE_KEY}.${direction}`, {
      change: Math.abs(change),
    }),
    tone: CHANGE_TONES[direction],
  };
}

function wrapDeleteWithCascade(
  base: DataControllerCallback,
): DataControllerCallback {
  return {
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: DeleteParams,
      ...rest: unknown[]
    ) {
      const result = await base.func.call(this, ctx, params, ...rest);
      invalidateSegmentNamesCache();
      const ids = Array.isArray(params.id) ? params.id : [params.id];
      const userSegmentModel = GetModel(UserSegmentModel);
      await Promise.all(
        ids.map((segmentId) =>
          userSegmentModel.cleanupUnpublishable(segmentId),
        ),
      );
      return result;
    },
  };
}

// Segments are written by the editor's own routes (`/api/saas/segments`),
// which validate the rules and re-evaluate on save: the table only reads,
// exports and deletes.
const segmentsRoutes = {
  get: TableViewRoutes.Get,
  list: TableViewRoutes.List,
  select: TableViewRoutes.Select,
  count: TableViewRoutes.Count,
  delete: wrapDeleteWithCascade(TableViewRoutes.Delete),
  ...TableViewRoutes.ExportRoutes,
};

@RegisterDataController()
@AuthOwnerOnly()
export class segmentsDataAPI extends DataController(
  Segment,
  segmentsRoutes,
  Controller("/api/saas/tables/segments"),
) {
  @ModelReference()
  @Model(SegmentModel)
  declare model: SegmentModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.segments.column.name",
    type: new DefaultDataTypes.StringType(),
    filterable: true,
    size: NAME_COLUMN_SIZE,
    display: new DefaultDisplays.IdentityDisplay({
      icon: "i-ph-funnel",
      subtitleField: "description",
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare name: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Column({
    name: "$saas.segments.column.description",
    type: new DefaultDataTypes.StringType({ textarea: true }),
    isVisible: false,
  })
  @Access(AccessMode.ReadWrite)
  declare description: string;

  @Select()
  @Listable()
  @Column({
    name: "$saas.segments.column.rules",
    type: new SegmentConditionsType({
      fieldsCatalogUrl: `${SEGMENTS_API_BASE}/fields`,
    }),
    cellWrap: true,
    size: RULES_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare conditions: SegmentConditionGroup;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.segments.column.estimated_count",
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.TwoLineDisplay({ subField: "weeklyChange" }),
  })
  @Access(AccessMode.ReadOnly)
  declare estimatedCount: number;

  @Select()
  @Access(AccessMode.ReadOnly)
  declare countHistory: SegmentCountPoint[];

  @Listable(["countHistory", "estimatedCount"])
  @Access(AccessMode.ReadOnly)
  get weeklyChange(): CellSubline {
    return weeklyChangeLine(
      weeklyCountChange(historyOf(this), rowOf(this).estimatedCount ?? 0),
    );
  }

  @Listable(["countHistory"])
  @Column({
    name: "$saas.segments.column.trend",
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.SparklineDisplay({ field: "countTrend" }),
  })
  @Access(AccessMode.ReadOnly)
  get countTrend(): number[] {
    return historyOf(this).map((point) => point.count);
  }

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.segments.column.last_evaluated_at",
    type: new DefaultDataTypes.DateType(),
    display: new DefaultDisplays.RelativeDateDisplay({
      emptyLabel: "$saas.segments.never_evaluated",
      emptyTone: "warning",
    }),
  })
  @Access(AccessMode.ReadOnly)
  declare lastEvaluatedAt: Date | null;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.segments.column.evaluation_time",
    type: new DefaultDataTypes.NumberType(),
    display: new DefaultDisplays.DurationDisplay({ unit: "ms" }),
    isVisible: false,
  })
  @Access(AccessMode.ReadOnly)
  declare lastEvaluationMs: number | null;
}
