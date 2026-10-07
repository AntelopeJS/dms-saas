import {
  Controller,
  Get,
  JSONBody,
  Post,
  Put,
} from "@antelopejs/interface-api";
import { assert, assertValidation } from "@antelopejs/interface-api-util";
import { Model } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { ZodError } from "zod";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  BillingSettingsModel,
  DEFAULT_STRIPE_TAX_CODE,
  LegalDocumentsModel,
  PlanModel,
} from "../../db";
import {
  type BillingRulesBody,
  billingRulesBodySchema,
  computePlanTaxSync,
  defaultBillingSettings,
  legalDocumentReleases,
  type PlanTaxSyncStatus,
  pickBillingRules,
  pickLegalTexts,
  pickSettingsUpdate,
  readLegalDocuments,
  saveLegalDocuments,
} from "../../operator-billing";
import {
  reconcilePlansWithStripe,
  startPlanReconciliation,
} from "../../plans/stripe-sync";
import { isStripeConfigured } from "../../stripe/client";

const HTTP_CONFLICT = 409;

/**
 * Everything the Billing rules & legal page loads: the settings, the legal
 * texts, and the read-only panels shown beside them (the customer timeline,
 * the refund example, the plans' tax sync, each document's release).
 */
export type BillingRulesPayload = Record<string, unknown>;

function parseBody(body: unknown): BillingRulesBody {
  return assertValidation(
    body,
    (value) => billingRulesBodySchema.parse(value),
    (error) => (error as ZodError).issues,
  );
}

function taxCodeOf(settings: Pick<BillingSettings, "stripeTaxCode">): string {
  return settings.stripeTaxCode || DEFAULT_STRIPE_TAX_CODE;
}

export class SaasBillingSettingsController extends Controller(
  "/api/saas/settings/billing",
) {
  @Model(BillingSettingsModel)
  declare billingSettingsModel: BillingSettingsModel;

  @Model(LegalDocumentsModel)
  declare legalDocumentsModel: LegalDocumentsModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  private async loadSettings(): Promise<BillingSettings> {
    const existing = await this.billingSettingsModel.get(
      BILLING_SETTINGS_SINGLETON_ID,
    );
    if (existing)
      return Object.assign(defaultBillingSettings(new Date()), existing);
    const fresh = defaultBillingSettings(new Date());
    await this.billingSettingsModel.insert([fresh]);
    return fresh;
  }

  private async planTaxSync(
    settings: BillingSettings,
  ): Promise<PlanTaxSyncStatus> {
    const plans = await this.planModel.findActiveNotDeleted();
    return computePlanTaxSync(
      plans,
      taxCodeOf(settings),
      settings.plansSyncedAt ?? null,
      isStripeConfigured(),
    );
  }

  private async payload(): Promise<BillingRulesPayload> {
    const settings = await this.loadSettings();
    const [legal, planTaxSync] = await Promise.all([
      readLegalDocuments(this.legalDocumentsModel),
      this.planTaxSync(settings),
    ]);
    const { versions, updatedAt: _legalUpdatedAt, ...texts } = legal;
    return {
      ...pickBillingRules(settings),
      ...texts,
      ...legalDocumentReleases(versions),
      customerTimeline: {
        autoSuspendEnabled: settings.autoSuspendEnabled,
        autoSuspendDelayDays: settings.autoSuspendDelayDays,
        dataRetentionDaysAfterCancellation:
          settings.dataRetentionDaysAfterCancellation,
      },
      refundExample: {
        moneyBackGuaranteeMode: settings.moneyBackGuaranteeMode,
      },
      planTaxSync,
    };
  }

  @Get("/")
  get(@AuthOwnerOnly() _user: User): Promise<BillingRulesPayload> {
    return this.payload();
  }

  /**
   * Saves the page in one go: the settings, then the legal texts, each
   * changed text published as its document's next version. A new tax
   * category is carried to the plans' Stripe products in the background.
   */
  @Put("/")
  async update(
    @AuthOwnerOnly() _user: User,
    @JSONBody() rawBody: unknown,
  ): Promise<BillingRulesPayload> {
    const body = parseBody(rawBody);
    const before = await this.loadSettings();
    const now = new Date();
    await this.billingSettingsModel.update(BILLING_SETTINGS_SINGLETON_ID, {
      ...pickSettingsUpdate(body),
      updatedAt: now,
    });
    await saveLegalDocuments(
      this.legalDocumentsModel,
      pickLegalTexts(body),
      now,
    );
    const isTaxCodeChanged =
      body.stripeTaxCode !== undefined &&
      body.stripeTaxCode !== taxCodeOf(before);
    if (isTaxCodeChanged && isStripeConfigured()) startPlanReconciliation();
    return this.payload();
  }

  /** Brings every plan's Stripe product and price in line, now. */
  @Post("/resync-plans")
  async resyncPlans(@AuthOwnerOnly() _user: User): Promise<PlanTaxSyncStatus> {
    assert(
      isStripeConfigured(),
      HTTP_CONFLICT,
      "saas.errors.stripe.not_configured",
    );
    await this.loadSettings();
    await reconcilePlansWithStripe();
    await this.billingSettingsModel.update(BILLING_SETTINGS_SINGLETON_ID, {
      plansSyncedAt: new Date(),
    });
    return this.planTaxSync(await this.loadSettings());
  }
}
