import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  BillingSettings,
  billingSettingsTableName,
} from "../tables/billingSettings.table";

/** Data access for platform-wide SaaS billing settings. */
export class BillingSettingsModel extends BasicDataModel(
  BillingSettings,
  billingSettingsTableName,
) {}
