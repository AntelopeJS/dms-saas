import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const billingSettingsTableName = "billing_settings";
export const BILLING_SETTINGS_SINGLETON_ID = "singleton";
export const DEFAULT_AUTO_SUSPEND_DELAY_DAYS = 14;

export const DEFAULT_STRIPE_TAX_CODE = "txcd_10000000";

/** Free workspaces a single card may back, when the setting is unset. */
export const DEFAULT_MAX_FREE_WORKSPACES_PER_CARD = 1;

/** Days a cancelled workspace's data is kept, when the setting is unset. */
export const DEFAULT_DATA_RETENTION_DAYS = 30;

export const REFUND_PRORATA_MODES = ["full", "prorated"] as const;
export type RefundProrataMode = (typeof REFUND_PRORATA_MODES)[number];

/** Platform-wide settings governing SaaS billing behavior. */
@RegisterTable(billingSettingsTableName, CORE_SCHEMA_NAME)
export class BillingSettings extends Table {
  @Field("string")
  declare _id: string;

  @Field("boolean")
  declare autoSuspendEnabled: boolean;

  @Field("number")
  declare autoSuspendDelayDays: number;

  @Field("number")
  declare dataRetentionDaysAfterCancellation: number;

  @Field("number")
  declare maxFreeWorkspacesPerCard: number;

  @Field("boolean")
  declare moneyBackGuaranteeEnabled: boolean;

  @Field("number")
  declare moneyBackGuaranteeWindowDays: number;

  @Field("string")
  declare moneyBackGuaranteeMode: RefundProrataMode;

  @Field("boolean")
  declare autoProrataOnCancelEnabled: boolean;

  @Field("string")
  declare stripeTaxCode: string | null;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
