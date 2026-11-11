import {
  CreationTime,
  Field,
  LocalizationModifier,
  Localized,
  type LocalizedRecords,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const featuresTableName = "features";

export const FEATURE_VALUE_TYPES = ["boolean", "number", "string"] as const;
export type FeatureValueType = (typeof FEATURE_VALUE_TYPES)[number];

/**
 * What a plan states for a feature: a switch, a limit or a label. `null`
 * states nothing, as a display-only feature the plan does not grant.
 */
export type FeatureValue = boolean | number | string | null;

/** Feature values of a plan, by feature id. */
export type FeatureValues = Record<string, FeatureValue>;

export const FEATURE_DEFAULT_ORDER = 0;

/** Locale a localized feature text falls back to when the reader's is missing. */
export const FEATURE_FALLBACK_LOCALE = "en";

/** Feature text written once per locale, e.g. `{ en: "Members", fr: "Membres" }`. */
export type FeatureLocalizedText = Record<string, string>;

/** Feature fields written once per locale and read in the caller's. */
export const FEATURE_LOCALIZED_FIELDS = [
  "displayName",
  "description",
  "tooltip",
  "unit",
] as const satisfies ReadonlyArray<keyof Feature>;

/** A feature field written once per locale. */
export type FeatureLocalizedField = (typeof FEATURE_LOCALIZED_FIELDS)[number];

/**
 * A feature with every locale of its texts unlocked, as
 * `feature.localize("*", FEATURE_LOCALIZED_FIELDS)` returns it. A localized
 * field is written one value per locale, e.g. `{ en: "Members", fr: "Membres" }`.
 * Read from the database it holds that record, a plain text stored as is, or
 * nothing when the text was never set. `localize(locale)` reads one locale again.
 */
export type FeatureInAllLocales = Omit<
  LocalizedRecords<Feature, FeatureLocalizedField>,
  FeatureLocalizedField
> & {
  [P in FeatureLocalizedField]:
    | Record<string, Exclude<Feature[P], undefined>>
    | Feature[P]
    | undefined;
};

/**
 * Feature definition available to SaaS plans.
 *
 * `displayName`, `description`, `tooltip` and `unit` are localized: read
 * them after `feature.localize(locale)`, write them through `localize("*")`
 * with one value per locale. A unit that agrees with its number is written
 * `singular | plural` (`project | projects`), as an i18n message is.
 */
@RegisterTable(featuresTableName, CORE_SCHEMA_NAME)
export class Feature extends Table.with(LocalizationModifier) {
  @Field("string")
  declare _id: string;

  @Localized({ fallbackLocale: FEATURE_FALLBACK_LOCALE })
  @Field("string")
  declare displayName: string;

  @Localized({ fallbackLocale: FEATURE_FALLBACK_LOCALE })
  @Field("string")
  declare description: string;

  @Field("string")
  declare valueType: FeatureValueType;

  @Field("any")
  declare defaultValue: FeatureValue;

  @Localized({ fallbackLocale: FEATURE_FALLBACK_LOCALE })
  @Field("string")
  declare tooltip: string | null;

  @Localized({ fallbackLocale: FEATURE_FALLBACK_LOCALE })
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
