import { z } from "zod";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  DEFAULT_DATA_RETENTION_DAYS,
  DEFAULT_MAX_FREE_WORKSPACES_PER_CARD,
  DEFAULT_STRIPE_TAX_CODE,
  LEGAL_DOCUMENT_KEYS,
  type LegalDocumentKey,
  type LegalDocumentVersion,
  type LegalDocumentVersions,
  type Plan,
  REFUND_PRORATA_MODES,
  type RefundProrataMode,
} from "../db";
import { isPlanStripeSyncCurrent } from "../stripe/sync-plan";

const DEFAULT_MONEY_BACK_WINDOW_DAYS = 14;
const DEFAULT_REFUND_MODE: RefundProrataMode = "full";
const MAX_DELAY_DAYS = 365;
const MAX_RETENTION_DAYS = 3650;
const MAX_FREE_WORKSPACES_PER_CARD = 100;
const MAX_LEGAL_TEXT_LENGTH = 500_000;
const STRIPE_TAX_CODE_PATTERN = /^txcd_\d{8}$/;

/** The public page each legal document is read on. */
const LEGAL_DOCUMENT_PATHS: Record<LegalDocumentKey, string> = {
  termsOfUse: "/terms-of-use",
  termsAndConditions: "/terms-and-conditions",
  privacyPolicy: "/privacy-policy",
};

/** The settings a fresh platform starts from. */
export function defaultBillingSettings(now: Date): BillingSettings {
  return {
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
    plansSyncedAt: null,
    updatedAt: now,
  } as BillingSettings;
}

/** The settings the Billing rules & legal page edits. */
const BILLING_RULES_SETTING_KEYS = [
  "autoSuspendEnabled",
  "autoSuspendDelayDays",
  "dataRetentionDaysAfterCancellation",
  "maxFreeWorkspacesPerCard",
  "moneyBackGuaranteeEnabled",
  "moneyBackGuaranteeWindowDays",
  "moneyBackGuaranteeMode",
  "autoProrataOnCancelEnabled",
  "stripeTaxCode",
] as const satisfies readonly (keyof BillingSettings)[];

/** The values of the settings the page edits, as the form loads them. */
export function pickBillingRules(
  settings: BillingSettings,
): Partial<BillingSettings> {
  return Object.fromEntries(
    BILLING_RULES_SETTING_KEYS.map((key) => [key, settings[key]]),
  );
}

const wholeNumber = (min: number, max: number, message: string) =>
  z.number().int({ message }).min(min, { message }).max(max, { message });

const legalText = z.string().max(MAX_LEGAL_TEXT_LENGTH, {
  message: "$saas.errors.billing_rules.legal_text_too_long",
});

/**
 * What the Billing rules & legal page saves. Every key is optional: a key left
 * out keeps its stored value. The read-only panels the page loads beside the
 * fields come back with the rest and are dropped.
 */
export const billingRulesBodySchema = z.object({
  autoSuspendEnabled: z.boolean().optional(),
  autoSuspendDelayDays: wholeNumber(
    1,
    MAX_DELAY_DAYS,
    "$saas.errors.billing_rules.suspension_days",
  ).optional(),
  dataRetentionDaysAfterCancellation: wholeNumber(
    0,
    MAX_RETENTION_DAYS,
    "$saas.errors.billing_rules.retention_days",
  ).optional(),
  maxFreeWorkspacesPerCard: wholeNumber(
    0,
    MAX_FREE_WORKSPACES_PER_CARD,
    "$saas.errors.billing_rules.free_workspaces_per_card",
  ).optional(),
  moneyBackGuaranteeEnabled: z.boolean().optional(),
  moneyBackGuaranteeWindowDays: wholeNumber(
    1,
    MAX_DELAY_DAYS,
    "$saas.errors.billing_rules.refund_window_days",
  ).optional(),
  moneyBackGuaranteeMode: z.enum(REFUND_PRORATA_MODES).optional(),
  autoProrataOnCancelEnabled: z.boolean().optional(),
  stripeTaxCode: z
    .string()
    .trim()
    .regex(STRIPE_TAX_CODE_PATTERN, {
      message: "$saas.errors.billing_rules.tax_code",
    })
    .optional(),
  termsOfUse: legalText.optional(),
  termsAndConditions: legalText.optional(),
  privacyPolicy: legalText.optional(),
});

export type BillingRulesBody = z.infer<typeof billingRulesBodySchema>;

/** The settings part of a saved body. */
export function pickSettingsUpdate(
  body: BillingRulesBody,
): Partial<BillingSettings> {
  const { termsOfUse, termsAndConditions, privacyPolicy, ...settings } = body;
  return Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value !== undefined),
  ) as Partial<BillingSettings>;
}

/** The legal texts part of a saved body. */
export function pickLegalTexts(
  body: BillingRulesBody,
): Partial<Record<LegalDocumentKey, string>> {
  return Object.fromEntries(
    LEGAL_DOCUMENT_KEYS.filter((key) => body[key] !== undefined).map((key) => [
      key,
      body[key],
    ]),
  );
}

/** How far the Stripe products of the plans carry the tax category. */
export interface PlanTaxSyncStatus {
  /** The tax category the counts are for. */
  taxCode: string;
  /** Plans billed through Stripe whose product and price are in line. */
  synced: number;
  /** Plans billed through Stripe. */
  total: number;
  syncedAt: Date | null;
  isStripeConfigured: boolean;
}

function isStripeBilled(plan: Plan): boolean {
  return plan.price > 0 || !!plan.paymentProviderRefs?.stripePriceId;
}

/**
 * Counts the plans whose Stripe product carries the tax category and the
 * rest of their terms.
 *
 * @param plans Active plans
 * @param taxCode The Stripe tax category in force
 * @param syncedAt When an operator last re-synced the plans
 * @param isStripeConfigured Whether Stripe can be reached at all
 */
export function computePlanTaxSync(
  plans: readonly Plan[],
  taxCode: string,
  syncedAt: Date | null,
  isStripeConfigured: boolean,
): PlanTaxSyncStatus {
  const billed = plans.filter(isStripeBilled);
  return {
    taxCode,
    synced: billed.filter((plan) => isPlanStripeSyncCurrent(plan, taxCode))
      .length,
    total: billed.length,
    syncedAt,
    isStripeConfigured,
  };
}

/** A legal document's release as the page shows it beside its text. */
export interface LegalDocumentRelease extends LegalDocumentVersion {
  path: string;
}

/** The release panels of the legal documents, keyed `<document>Release`. */
export function legalDocumentReleases(
  versions: LegalDocumentVersions,
): Record<string, LegalDocumentRelease> {
  return Object.fromEntries(
    LEGAL_DOCUMENT_KEYS.map((key) => [
      `${key}Release`,
      { ...versions[key], path: LEGAL_DOCUMENT_PATHS[key] },
    ]),
  );
}
