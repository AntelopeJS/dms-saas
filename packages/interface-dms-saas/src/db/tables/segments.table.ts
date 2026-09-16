import {
  CreationTime,
  Field,
  Index,
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

  @Field("string")
  declare revision?: string;

  /** Only memberships in this fully written generation are visible. */
  @Field("string")
  declare membershipGeneration?: string;

  @Index()
  @Field("date")
  declare lastEvaluatedAt: Date | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
