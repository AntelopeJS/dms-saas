import { randomUUID } from "node:crypto";
import { MakePropertyDecorator } from "@antelopejs/interface-core/decorators";
import {
  attachModifier,
  CreationTime,
  Field,
  Index,
  Modifier,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const segmentsTableName = "segments";

export const SEGMENT_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "nin",
  "contains",
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

export const SEGMENT_LOGICAL = ["and", "or"] as const;
export type SegmentLogical = (typeof SEGMENT_LOGICAL)[number];

export const SEGMENT_QUANTIFIERS = ["any", "all"] as const;
export type SegmentQuantifier = (typeof SEGMENT_QUANTIFIERS)[number];

export const SEGMENT_MEMBER_ROLES = ["member", "owner"] as const;
export type SegmentMemberRole = (typeof SEGMENT_MEMBER_ROLES)[number];

export interface SegmentCondition {
  field: string;
  operator: SegmentOperator;
  value: unknown;
}

/**
 * Matches when `quantifier` of the user's workspaces satisfy the nested
 * workspace-field conditions. `role` restricts which memberships are
 * considered: "owner" keeps only owned workspaces, "member" (default,
 * absent on legacy rows) keeps them all.
 */
export interface SegmentWorkspaceRef {
  kind: "workspaceRef";
  quantifier: SegmentQuantifier;
  role?: SegmentMemberRole;
  conditions: SegmentConditionGroup;
}

export interface SegmentConditionGroup {
  logical: SegmentLogical;
  conditions: (
    | SegmentCondition
    | SegmentConditionGroup
    | SegmentWorkspaceRef
  )[];
}

/** The number of users a segment matched on one day. */
export interface SegmentCountPoint {
  /** Day of the evaluation, `YYYY-MM-DD` in UTC. */
  day: string;
  count: number;
}

class RevisionModifier extends Modifier {
  insert(object: Record<string, unknown>, field: string): void {
    object[field] = randomUUID();
  }

  update(object: Record<string, unknown>, field: string): void {
    object[field] = randomUUID();
  }
}

type AttachFieldModifier = (
  tableClass: new () => object,
  modifier: new () => Modifier,
  field: string,
  // Mirrors the shape the database decorators declare, where the value
  // is genuinely opaque to this side.
  // oxlint-disable-next-line anti-slop/no-object-parameters
  options: object,
) => void;

/**
 * Seeds the revision on every insert event and rotates it on every update
 * event. The platform data API writes through the raw table rather than
 * `SegmentModel`, so without this it could create a segment the
 * compare-and-set mutations would refuse, or edit its conditions while a
 * recompute of the previous conditions can still publish.
 */
const Revision = MakePropertyDecorator((target, propertyKey) => {
  (attachModifier as AttachFieldModifier)(
    target.constructor as new () => object,
    RevisionModifier,
    propertyKey as string,
    {},
  );
});

/** Reusable audience segment evaluated against platform data. */
@RegisterTable(segmentsTableName, CORE_SCHEMA_NAME)
export class Segment extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare name: string;

  @Field("string")
  declare description: string;

  @Field("any")
  declare conditions: SegmentConditionGroup;

  @Field("number")
  declare estimatedCount: number;

  @Revision()
  @Field("string")
  declare revision: string;

  /** Only memberships in this fully written generation are visible. */
  @Field("string")
  declare membershipGeneration?: string;

  @Index()
  @Field("date")
  declare lastEvaluatedAt: Date | null;

  /**
   * The count of each day the segment was evaluated, oldest first, over the
   * last `SEGMENT_COUNT_HISTORY_DAYS` days: the trend and the weekly change
   * of the segments list read it.
   */
  @Field("any")
  declare countHistory?: SegmentCountPoint[];

  /** How long the last evaluation took, in milliseconds. */
  @Field("number")
  declare lastEvaluationMs?: number | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
