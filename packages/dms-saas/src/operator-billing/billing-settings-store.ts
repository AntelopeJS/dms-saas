import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  DEFAULT_DATA_RETENTION_DAYS,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  DEFAULT_STRIPE_TAX_CODE,
  type RefundProrataMode,
} from "../db";

const DEFAULT_MONEY_BACK_WINDOW_DAYS = 14;
const DEFAULT_REFUND_MODE: RefundProrataMode = "full";

/** The billing rules the Billing rules & legal page edits. */
export type BillingRules = Pick<
  BillingSettings,
  | "autoSuspendEnabled"
  | "autoSuspendDelayDays"
  | "dataRetentionDaysAfterCancellation"
  | "maxFreeWorkspacesPerCard"
  | "moneyBackGuaranteeEnabled"
  | "moneyBackGuaranteeWindowDays"
  | "moneyBackGuaranteeMode"
  | "autoProrataOnCancelEnabled"
  | "stripeTaxCode"
>;

/**
 * The module defaults of the billing rules: what a fresh platform starts
 * from, and what the page offers to put back ("Use default").
 */
export function defaultBillingRules(): BillingRules {
  return {
    autoSuspendEnabled: true,
    autoSuspendDelayDays: DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
    dataRetentionDaysAfterCancellation: DEFAULT_DATA_RETENTION_DAYS,
    maxFreeWorkspacesPerCard: DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
    moneyBackGuaranteeEnabled: false,
    moneyBackGuaranteeWindowDays: DEFAULT_MONEY_BACK_WINDOW_DAYS,
    moneyBackGuaranteeMode: DEFAULT_REFUND_MODE,
    autoProrataOnCancelEnabled: false,
    stripeTaxCode: DEFAULT_STRIPE_TAX_CODE,
  };
}

/** The settings a fresh platform starts from. */
function defaultBillingSettings(now: Date): BillingSettings {
  return {
    _id: BILLING_SETTINGS_SINGLETON_ID,
    ...defaultBillingRules(),
    plansSyncedAt: null,
    updatedAt: now,
  } as BillingSettings;
}

/**
 * Writes the default settings once, so the row exists before anyone saves.
 *
 * @param model The billing settings model
 */
export async function ensureBillingSettingsRow(
  model: BillingSettingsModel = GetModel(BillingSettingsModel),
): Promise<void> {
  if (await model.get(BILLING_SETTINGS_SINGLETON_ID)) return;
  await model.insert([defaultBillingSettings(new Date())]);
}

/**
 * The billing settings: the saved row, written with the defaults on start.
 * The defaults stand in only until that first write lands.
 *
 * @param model The billing settings model
 */
export async function loadBillingSettings(
  model: BillingSettingsModel = GetModel(BillingSettingsModel),
): Promise<BillingSettings> {
  const stored = await model.get(BILLING_SETTINGS_SINGLETON_ID);
  return stored ?? defaultBillingSettings(new Date());
}
