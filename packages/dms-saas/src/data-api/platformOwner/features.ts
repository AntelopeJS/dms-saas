import { Controller, Parameter } from "@antelopejs/interface-api";
import {
  DataController,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import {
  Access,
  AccessMode,
  Listable,
  Mandatory,
  ModelReference,
  ModifierKey,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import {
  GetModel,
  LocalizationModifier,
  Model,
} from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  DefaultDisplays,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
  type Tone,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { ReadonlyBehaviorType } from "@antelopejs/interface-dms/base/types";
import {
  FEATURE_VALUE_TYPES,
  Feature,
  FeatureModel,
  type FeatureValueType,
  PlanModel,
} from "../../db";
import { plansUsingFeature } from "../../plans/feature-usage";
import { FeatureUsageDisplay } from "../../plans/plan-displays";
import { CONTENT_LANGUAGE_HEADER } from "../../utils/content-language";

const TEXTS = "$saas.catalog.features";

interface ValueTypeLook {
  icon: string;
  tone: Tone;
}

const VALUE_TYPE_LOOKS: Record<FeatureValueType, ValueTypeLook> = {
  boolean: { icon: "i-ph-toggle-right", tone: "success" },
  number: { icon: "i-ph-hash", tone: "primary" },
  string: { icon: "i-ph-text-t", tone: "warning" },
};

const VALUE_TYPE_OPTIONS = FEATURE_VALUE_TYPES.map((value) => ({
  label: `${TEXTS}.value_type.${value}`,
  description: `${TEXTS}.value_type.${value}_description`,
  icon: VALUE_TYPE_LOOKS[value].icon,
  value,
}));

const VALUE_TYPE_TONES = Object.fromEntries(
  FEATURE_VALUE_TYPES.map((value) => [value, VALUE_TYPE_LOOKS[value].tone]),
);

const DESCRIPTION_ROWS = 2;
// The visible columns fit a 1440px screen without scrolling, scrollbar included.
const NAME_COLUMN_SIZE = 205;
const KEY_COLUMN_SIZE = 175;
const COMPARISON_COLUMN_SIZE = 180;
const SHORT_COLUMN_SIZE = 110;
const VALUE_TYPE_COLUMN_SIZE = 150;
const UNIT_COLUMN_SIZE = 85;
const ORDER_COLUMN_SIZE = 110;

interface FeatureRowInstance {
  table: Feature;
}

function featureRowOf(self: unknown): Feature {
  return (self as FeatureRowInstance).table;
}

function featureIdOf(self: unknown): string {
  return featureRowOf(self)._id;
}

/**
 * The features plans switch on or limit, one row each of the pricing page's
 * comparison table, in their order.
 */
@RegisterDataController()
@AuthOwnerOnly()
export class featuresDataAPI extends DataController(
  Feature,
  TableViewRoutes.All,
  Controller("/api/saas/tables/features"),
) {
  @ModelReference()
  @Model(FeatureModel)
  declare model: FeatureModel;

  @Parameter(CONTENT_LANGUAGE_HEADER, "header")
  @ModifierKey(LocalizationModifier)
  declare language: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Mandatory("new", "edit")
  @Column({
    name: `${TEXTS}.column.display_name`,
    description: `${TEXTS}.column.display_name_description`,
    type: new DefaultDataTypes.StringType({
      placeholder: `${TEXTS}.placeholder.display_name`,
    }),
    display: new DefaultDisplays.IdentityDisplay({
      icon: VALUE_TYPE_LOOKS.boolean.icon,
      iconField: "valueTypeIcon",
      subtitleField: "description",
    }),
    size: NAME_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare displayName: string;

  /** The tile beside the name: the icon of the feature's value type. */
  @Listable(["valueType"])
  @Access(AccessMode.ReadOnly)
  get valueTypeIcon(): string | null {
    return VALUE_TYPE_LOOKS[featureRowOf(this).valueType]?.icon ?? null;
  }

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.key`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    readonlyBehavior: {
      new: ReadonlyBehaviorType.hidden,
      edit: ReadonlyBehaviorType.disabled,
      view: ReadonlyBehaviorType.disabled,
    },
    size: KEY_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.description`,
    description: `${TEXTS}.column.description_description`,
    type: new DefaultDataTypes.StringType({
      textarea: true,
      rows: DESCRIPTION_ROWS,
    }),
    isVisible: false,
  })
  @Access(AccessMode.ReadWrite)
  declare description: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Mandatory("new", "edit")
  @Column({
    name: `${TEXTS}.column.value_type`,
    description: `${TEXTS}.column.value_type_description`,
    type: new DefaultDataTypes.SelectType({
      items: VALUE_TYPE_OPTIONS,
      display: "cards",
    }),
    display: new DefaultDisplays.StatusPillDisplay({ tones: VALUE_TYPE_TONES }),
    filterable: true,
    size: VALUE_TYPE_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare valueType: string;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.unit`,
    description: `${TEXTS}.column.unit_description`,
    type: new DefaultDataTypes.StringType({
      placeholder: `${TEXTS}.placeholder.unit`,
    }),
    size: UNIT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare unit: string | null;

  @Listable(["_id"])
  @Column({
    name: `${TEXTS}.column.used_by`,
    type: new DefaultDataTypes.NumberType(),
    display: new FeatureUsageDisplay(),
    readonlyBehavior: {
      new: ReadonlyBehaviorType.hidden,
      edit: ReadonlyBehaviorType.hidden,
      view: ReadonlyBehaviorType.disabled,
    },
    size: SHORT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadOnly)
  get usedBy(): Promise<number> {
    const featureId = featureIdOf(this);
    return GetModel(PlanModel)
      .findNotDeleted()
      .then((plans) => plansUsingFeature(plans, featureId).length);
  }

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.is_detail_row`,
    description: `${TEXTS}.column.is_detail_row_description`,
    type: new DefaultDataTypes.BooleanType({
      label: `${TEXTS}.column.is_detail_row_label`,
    }),
    display: new DefaultDisplays.IndicatorDisplay({
      onLabel: `${TEXTS}.row.detail`,
      offLabel: `${TEXTS}.row.main`,
      onIcon: "i-ph-eye-slash",
      offIcon: "i-ph-rows",
      onTone: "muted",
      offTone: "default",
    }),
    filterable: true,
    size: COMPARISON_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare isDetailRow: boolean;

  @Select()
  @Exported()
  @Column({
    name: `${TEXTS}.column.tooltip`,
    description: `${TEXTS}.column.tooltip_description`,
    type: new DefaultDataTypes.StringType({
      placeholder: `${TEXTS}.placeholder.tooltip`,
    }),
    isVisible: false,
  })
  @Access(AccessMode.ReadWrite)
  declare tooltip: string | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: `${TEXTS}.column.order`,
    description: `${TEXTS}.column.order_description`,
    type: new DefaultDataTypes.NumberType({ min: 0, step: 1 }),
    size: ORDER_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare order: number;
}
