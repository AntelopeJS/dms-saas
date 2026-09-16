import { RegisterDataType } from "@antelopejs/interface-dms/base/data-types";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

/**
 * A billing cycle identified by its start date. Filters and sorting behave as
 * plain dates; the console renders it as the month it covers ("June 2026"),
 * matching how an invoice period is actually read.
 */
@RegisterDataType("billing_period")
export class BillingPeriodType extends DefaultDataTypes.DateType {}
