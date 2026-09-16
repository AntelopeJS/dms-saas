import { Controller } from "@antelopejs/interface-api";
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
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { FEATURE_VALUE_TYPES, Feature, FeatureModel } from "../../db";

const VALUE_TYPE_OPTIONS = FEATURE_VALUE_TYPES.map((value) => ({
  label: value,
  value,
}));

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

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @Searchable()
  @Exported()
  @Sortable()
  @Mandatory("new", "edit")
  @Column({
    name: "$saas.features.column.display_name",
    description: "$saas.features.column.display_name_description",
    type: new DefaultDataTypes.StringType({
      placeholder: "$saas.features.placeholder.display_name",
    }),
    filterable: true,
  })
  @Access(AccessMode.ReadWrite)
  declare displayName: string;

  @Select()
  @Exported()
  @Column({
    name: "$saas.features.column.description",
    description: "$saas.features.column.description_description",
    type: new DefaultDataTypes.RichTextType(),
  })
  @Access(AccessMode.ReadWrite)
  declare description: string;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Mandatory("new", "edit")
  @Column({
    name: "$saas.features.column.value_type",
    description: "$saas.features.column.value_type_description",
    type: new DefaultDataTypes.SelectType({ items: VALUE_TYPE_OPTIONS }),
    filterable: true,
  })
  @Access(AccessMode.ReadWrite)
  declare valueType: string;

  @Select()
  @Exported()
  @Column({
    name: "$saas.features.column.tooltip",
    description: "$saas.features.column.tooltip_description",
    type: new DefaultDataTypes.StringType({
      placeholder: "$saas.features.placeholder.tooltip",
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare tooltip: string | null;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.features.column.unit",
    description: "$saas.features.column.unit_description",
    type: new DefaultDataTypes.StringType({
      placeholder: "$saas.features.placeholder.unit",
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare unit: string | null;

  @Select()
  @Listable()
  @Exported()
  @Column({
    name: "$saas.features.column.is_detail_row",
    description: "$saas.features.column.is_detail_row_description",
    type: new DefaultDataTypes.BooleanType(),
    filterable: true,
  })
  @Access(AccessMode.ReadWrite)
  declare isDetailRow: boolean;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$saas.features.column.order",
    description: "$saas.features.column.order_description",
    type: new DefaultDataTypes.NumberType(),
  })
  @Access(AccessMode.ReadWrite)
  declare order: number;
}
