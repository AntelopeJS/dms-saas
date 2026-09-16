import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";

const SEGMENT_OPERATOR_VALUES = [
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

const conditionSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.object({
      field: z.string(),
      operator: z.enum(SEGMENT_OPERATOR_VALUES),
      value: z.unknown(),
    }),
    z.object({
      kind: z.literal("workspaceRef"),
      quantifier: z.enum(["any", "all"]),
      role: z.enum(["member", "owner"]).optional(),
      conditions: groupSchema,
    }),
    z.object({
      logical: z.enum(["and", "or"]),
      conditions: z.array(conditionSchema),
    }),
  ]),
);

const groupSchema = z.object({
  logical: z.enum(["and", "or"]),
  conditions: z.array(conditionSchema),
});

const stringOrGroupSchema = z
  .union([z.string(), groupSchema])
  .transform((value) => {
    if (typeof value === "string") {
      if (value === "") return { logical: "and", conditions: [] };
      try {
        return JSON.parse(value);
      } catch {
        return { logical: "and", conditions: [] };
      }
    }
    return value;
  })
  .pipe(groupSchema);

export interface SegmentConditionsTypeOptions {
  fieldsCatalogUrl?: string;
  [key: string]: unknown;
}

@RegisterDataType("segment_conditions")
export class SegmentConditionsType extends DataType {
  constructor(public readonly options: SegmentConditionsTypeOptions = {}) {
    super([], undefined, options);
  }

  protected defaultInputComponent() {
    return CustomComponent("DmsSaasSegmentConditionsBuilder")
      .options({
        fieldsCatalogUrl: this.options.fieldsCatalogUrl,
      })
      .serializeSync();
  }

  getValidation() {
    return stringOrGroupSchema;
  }
}
