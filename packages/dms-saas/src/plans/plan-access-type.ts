import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";

/** Options of {@link PlanAccessType}: where its editor reads the permissions. */
export interface PlanAccessTypeOptions {
  permissionsTreeUrl?: string;
  [key: string]: unknown;
}

const planAccessSchema = z
  .object({
    parentPlanId: z.string().nullable(),
    extraPermissions: z.array(z.string()),
    extraFeatures: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/**
 * The access part of a plan as one value: the parent it follows live, its own
 * permissions, and the feature values it overrides (a feature left out is
 * inherited). Edited by the plan editor's access editor.
 */
@RegisterDataType("saas:plan-access")
export class PlanAccessType extends DataType {
  constructor(public readonly options: PlanAccessTypeOptions = {}) {
    super([], undefined, options);
  }

  protected defaultInputComponent() {
    return CustomComponent("DmsSaasPlanAccessEditor")
      .options({
        permissionsTreeUrl: this.options.permissionsTreeUrl,
      })
      .serializeSync();
  }

  getValidation() {
    return planAccessSchema;
  }
}
