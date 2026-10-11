import { ColumnDisplay, RegisterDisplay } from "@antelopejs/interface-dms/base";

/** Where a period cell finds the end of the period. */
export interface BillingPeriodDisplayOptions {
  /** Row field holding the end of the period. */
  endField: string;
}

/** A billing period from the column's date to the end field ("Sep 29 – Oct 28"). */
@RegisterDisplay("saas:period")
export class BillingPeriodDisplay extends ColumnDisplay<BillingPeriodDisplayOptions> {}
