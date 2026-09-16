import {
  CreationTime,
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const featuresTableName = "features";

export const FEATURE_VALUE_TYPES = ["boolean", "number", "string"] as const;
export type FeatureValueType = (typeof FEATURE_VALUE_TYPES)[number];

export const FEATURE_DEFAULT_ORDER = 0;

/** Feature definition available to SaaS plans. */
@RegisterTable(featuresTableName, CORE_SCHEMA_NAME)
export class Feature extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare displayName: string;

  @Field("string")
  declare description: string;

  @Field("string")
  declare valueType: FeatureValueType;

  @Field("any")
  declare defaultValue: unknown;

  @Field("string")
  declare tooltip: string | null;

  @Field("string")
  declare unit: string | null;

  @Field("boolean")
  declare isDetailRow: boolean;

  @Field("number")
  declare order: number;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
