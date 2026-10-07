import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";

/**
 * A read-only panel among a form's fields, drawn by a module component from
 * the value the form loaded under the field's id (a timeline computed from
 * the settings, a sync status). The form sends it back with the rest; the
 * route ignores it, so any value validates.
 */
@RegisterDataType("saas_form_insight")
export class FormInsightType extends DataType {
  constructor(private readonly componentName: string) {
    super([], undefined, { componentName });
  }

  protected defaultInputComponent() {
    return CustomComponent(this.componentName).serializeSync();
  }

  getValidation() {
    return z.unknown();
  }
}
