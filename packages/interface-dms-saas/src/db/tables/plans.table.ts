import {
  CreationTime,
  Field,
  Index,
  LocalizationModifier,
  Localized,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { FeatureValue } from "./features.table";

export const plansTableName = "plans";

/** Locale a localized plan text falls back to when the reader's is missing. */
export const PLAN_FALLBACK_LOCALE = "en";

/** Plan text written once per locale, e.g. `{ en: "For teams", fr: "Pour les équipes" }`. */
export type PlanLocalizedText = Record<string, string>;

export const PLAN_AUDIENCES = ["any", "individual", "business"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

export const PLAN_INTERVALS = ["month", "year"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const PLAN_BILLING_MODES = ["flat", "seat"] as const;
export type PlanBillingMode = (typeof PLAN_BILLING_MODES)[number];

export interface PlanFeatureValue {
  featureId: string;
  value: FeatureValue;
}

/** Plan fields a Stripe product carries, in {@link PLAN_FALLBACK_LOCALE}. */
export interface PlanStripeProductTerms {
  name: string;
  description: string;
  taxCode: string;
}

/** Plan fields a Stripe price carries; Stripe prices are immutable. */
export interface PlanStripePriceTerms {
  /** Amount in the currency's minor unit. */
  unitAmount: number;
  /** Lowercase ISO 4217 code, as Stripe stores it. */
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
}

/** What the linked Stripe product and price were last synced from. */
export interface PlanStripeSyncedTerms {
  product: PlanStripeProductTerms;
  price: PlanStripePriceTerms;
}

/**
 * Payment provider objects a plan is billed through. dms-saas owns them: it
 * keeps them in line with the plan whoever writes the plan, so writers leave
 * them alone.
 */
export interface PlanProviderRefs {
  stripeProductId?: string;
  stripePriceId?: string;
  /** Absent on plans never synced, or synced before dms-saas recorded it. */
  stripeSyncedTerms?: PlanStripeSyncedTerms;
}

/** Plan fields written once per locale and read in the caller's. */
export const PLAN_LOCALIZED_FIELDS: Array<keyof Plan> = [
  "name",
  "description",
  "borderLabel",
];

/** A member cap or feature limit no workspace reaches. */
export const PLAN_UNLIMITED = -1;

/**
 * Commercial plan offered to SaaS workspaces.
 *
 * `name`, `description` and `borderLabel` are texts the operator writes:
 * localized, read after `plan.localize(locale)` (`PlanModel` reads them in
 * {@link PLAN_FALLBACK_LOCALE}), written through `localize("*")` with one
 * value per locale.
 */
@RegisterTable(plansTableName, CORE_SCHEMA_NAME)
export class Plan extends Table.with(LocalizationModifier) {
  @Field("string")
  declare _id: string;

  @Localized({ fallbackLocale: PLAN_FALLBACK_LOCALE })
  @Field("string")
  declare name: string;

  @Index()
  @Field("string")
  declare slug: string;

  @Localized({ fallbackLocale: PLAN_FALLBACK_LOCALE })
  @Field("string")
  declare description: string;

  @Index()
  @Field("string")
  declare audience: PlanAudience;

  @Field("number")
  declare price: number;

  @Field("string")
  declare currency: string;

  @Field("string")
  declare interval: PlanInterval;

  @Field("string")
  declare billingMode: PlanBillingMode;

  @Field("any")
  declare features: PlanFeatureValue[];

  @Field(["string"])
  declare permissions: string[];

  @Field("string")
  @Relation({ to: () => Plan })
  declare inheritsFromPlanId: string | null;

  @Field("number")
  declare trialDays: number;

  /** -1 means unlimited members; 0+ is the seat cap. */
  @Field("number")
  declare maxMembers: number;

  @Index()
  @Field("boolean")
  declare isPublic: boolean;

  @Field("any")
  declare paymentProviderRefs: PlanProviderRefs;

  @Field("string")
  declare borderColor: string | null;

  @Localized({ fallbackLocale: PLAN_FALLBACK_LOCALE })
  @Field("string")
  declare borderLabel: string | null;

  @Index()
  @Field("number")
  declare order: number;

  @Index()
  @Field("boolean")
  declare isActive: boolean;

  @Field("boolean")
  declare isDeleted: boolean;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
