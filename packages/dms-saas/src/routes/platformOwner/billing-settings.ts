import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  DEFAULT_DATA_RETENTION_DAYS,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  DEFAULT_STRIPE_TAX_CODE,
  type RefundProrataMode,
} from "../../db";

const DEFAULT_MONEY_BACK_WINDOW_DAYS = 14;
const DEFAULT_REFUND_MODE: RefundProrataMode = "full";

interface BillingSettingsBody {
  autoSuspendEnabled?: boolean;
  autoSuspendDelayDays?: number;
  dataRetentionDaysAfterCancellation?: number;
  maxFreeWorkspacesPerCard?: number;
  moneyBackGuaranteeEnabled?: boolean;
  moneyBackGuaranteeWindowDays?: number;
  moneyBackGuaranteeMode?: RefundProrataMode;
  autoProrataOnCancelEnabled?: boolean;
  stripeTaxCode?: string | null;
}

function pickBillingSettingsUpdate(body: BillingSettingsBody) {
  const out: Record<string, unknown> = {};
  if (body.autoSuspendEnabled !== undefined)
    out.autoSuspendEnabled = body.autoSuspendEnabled;
  if (body.autoSuspendDelayDays !== undefined)
    out.autoSuspendDelayDays = body.autoSuspendDelayDays;
  if (body.dataRetentionDaysAfterCancellation !== undefined)
    out.dataRetentionDaysAfterCancellation =
      body.dataRetentionDaysAfterCancellation;
  if (body.maxFreeWorkspacesPerCard !== undefined)
    out.maxFreeWorkspacesPerCard = body.maxFreeWorkspacesPerCard;
  if (body.moneyBackGuaranteeEnabled !== undefined)
    out.moneyBackGuaranteeEnabled = body.moneyBackGuaranteeEnabled;
  if (body.moneyBackGuaranteeWindowDays !== undefined)
    out.moneyBackGuaranteeWindowDays = body.moneyBackGuaranteeWindowDays;
  if (body.moneyBackGuaranteeMode !== undefined)
    out.moneyBackGuaranteeMode = body.moneyBackGuaranteeMode;
  if (body.autoProrataOnCancelEnabled !== undefined)
    out.autoProrataOnCancelEnabled = body.autoProrataOnCancelEnabled;
  if (body.stripeTaxCode !== undefined)
    out.stripeTaxCode = body.stripeTaxCode || null;
  return out;
}

async function getOrCreateBillingSettings(
  billingSettingsModel: BillingSettingsModel,
) {
  const existing = await billingSettingsModel.get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  if (existing) return existing;
  const fresh = {
    _id: BILLING_SETTINGS_SINGLETON_ID,
    autoSuspendEnabled: true,
    autoSuspendDelayDays: DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
    dataRetentionDaysAfterCancellation: DEFAULT_DATA_RETENTION_DAYS,
    maxFreeWorkspacesPerCard: DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
    moneyBackGuaranteeEnabled: false,
    moneyBackGuaranteeWindowDays: DEFAULT_MONEY_BACK_WINDOW_DAYS,
    moneyBackGuaranteeMode: DEFAULT_REFUND_MODE,
    autoProrataOnCancelEnabled: false,
    stripeTaxCode: DEFAULT_STRIPE_TAX_CODE,
    updatedAt: new Date(),
  };
  await billingSettingsModel.insert([fresh]);
  return fresh;
}

export class SaasBillingSettingsController extends Controller(
  "/api/saas/settings/billing",
) {
  @Model(BillingSettingsModel)
  declare billingSettingsModel: BillingSettingsModel;

  @Get("/")
  get(@AuthOwnerOnly() _user: User) {
    return getOrCreateBillingSettings(this.billingSettingsModel);
  }

  @Put("/")
  async update(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: BillingSettingsBody,
  ) {
    await getOrCreateBillingSettings(this.billingSettingsModel);
    await this.billingSettingsModel.update(BILLING_SETTINGS_SINGLETON_ID, {
      ...pickBillingSettingsUpdate(body),
      updatedAt: new Date(),
    });
    return getOrCreateBillingSettings(this.billingSettingsModel);
  }
}
