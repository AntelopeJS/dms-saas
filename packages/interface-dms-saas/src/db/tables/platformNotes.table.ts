import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";

export const platformNotesTableName = "platform_notes";

export const PLATFORM_NOTE_TARGET_TYPES = ["user", "workspace"] as const;
export type PlatformNoteTargetType =
  (typeof PLATFORM_NOTE_TARGET_TYPES)[number];

/** Administrative note attached to a platform user or workspace. */
@RegisterTable(platformNotesTableName, CORE_SCHEMA_NAME)
export class PlatformNote extends Table {
  @Field("string")
  declare _id: string;

  @Index()
  @Field("string")
  declare targetType: PlatformNoteTargetType;

  @Index()
  @Field("string")
  declare targetId: string;

  @Index()
  @Field("string")
  @Relation({ to: () => User })
  declare authorId: string;

  @Field("string")
  declare content: string;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
