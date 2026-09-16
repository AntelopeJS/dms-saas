import {
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { Segment } from "./segments.table";

export const userSegmentsTableName = "user_segments";

/** Materialized membership between a user and an audience segment. */
@RegisterTable(userSegmentsTableName, CORE_SCHEMA_NAME)
export class UserSegment extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare userId: string;

  @Index()
  @Field("string")
  @Relation({ to: () => Segment })
  declare segmentId: string;

  @Field("string")
  declare generation?: string;

  @Field("string")
  declare sourceRevision?: string;

  @Field("string")
  declare revision?: string;

  @Field("date")
  declare evaluatedAt: Date;
}
