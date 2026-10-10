import {
  ColumnDisplay,
  RegisterDisplay,
} from "@antelopejs/interface-dms/base/table-view";

/** Options of {@link PlanMoneyDisplay}. */
export interface PlanMoneyDisplayOptions {
  /** Row field holding the ISO 4217 code the amount is in. */
  currencyField: string;
}

/**
 * An amount in major units drawn in the currency of its row (`€29`,
 * `$1,250`), where the built-in price cell knows no currency.
 */
@RegisterDisplay("saas:plan-money")
export class PlanMoneyDisplay extends ColumnDisplay<PlanMoneyDisplayOptions> {}

/** How many plans store a value of a feature: "7 plans", "Not used yet". */
@RegisterDisplay("saas:feature-usage")
export class FeatureUsageDisplay extends ColumnDisplay<Record<string, never>> {}

/** A member cap: the number, or "Unlimited" for `-1`. */
@RegisterDisplay("saas:plan-member-cap")
export class PlanMemberCapDisplay extends ColumnDisplay<
  Record<string, never>
> {}
