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
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { ReadonlyBehaviorType } from "@antelopejs/interface-dms/base/types";
import {
  FEATURE_VALUE_TYPES,
  Feature,
  FeatureModel,
  PlanModel,
} from "../../db";
import { plansUsingFeature } from "../../plans/feature-usage";
import { FeatureUsageDisplay } from "../../plans/plan-displays";
import { CONTENT_LANGUAGE_HEADER } from "../../utils/content-language";

const TEXTS = "$saas.catalog.features";

const VALUE_TYPE_OPTIONS = FEATURE_VALUE_TYPES.map((value) => ({
  label: `${TEXTS}.value_type.${value}`,
  description: `${TEXTS}.value_type.${value}_description`,
  value,
}));

const DESCRIPTION_ROWS = 2;
const NAME_COLUMN_SIZE = 260;
const SHORT_COLUMN_SIZE = 120;

interface FeatureRowInstance {
  table: Feature;
}

function featureIdOf(self: unknown): string {
  return (self as FeatureRowInstance).table._id;
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
  @Column({
    name: `${TEXTS}.column.key`,
    type: new DefaultDataTypes.StringType(),
    display: new DefaultDisplays.MonoDisplay({ copy: true }),
    readonlyBehavior: {
      new: ReadonlyBehaviorType.hidden,
      edit: ReadonlyBehaviorType.disabled,
      view: ReadonlyBehaviorType.disabled,
    },
    size: SHORT_COLUMN_SIZE * 2,
  })
  @Access(AccessMode.ReadOnly)
  declare _id: string;

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
      icon: "i-ph-toggle-right",
      subtitleField: "description",
    }),
    size: NAME_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare displayName: string;

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
    filterable: true,
    size: SHORT_COLUMN_SIZE,
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
    size: SHORT_COLUMN_SIZE,
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
    size: SHORT_COLUMN_SIZE * 2,
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
    size: SHORT_COLUMN_SIZE,
  })
  @Access(AccessMode.ReadWrite)
  declare order: number;
}
