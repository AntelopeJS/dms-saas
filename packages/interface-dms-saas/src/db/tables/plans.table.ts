import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Relation,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const plansTableName = "plans";

export const PLAN_AUDIENCES = ["any", "individual", "business"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

export const PLAN_INTERVALS = ["month", "year"] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const PLAN_BILLING_MODES = ["flat", "seat"] as const;
export type PlanBillingMode = (typeof PLAN_BILLING_MODES)[number];

export interface PlanFeatureValue {
  featureId: string;
  value: unknown;
}

export interface PlanProviderRefs {
  stripeProductId?: string;
  stripePriceId?: string;
}

/** Commercial plan offered to SaaS workspaces. */
@RegisterTable(plansTableName, CORE_SCHEMA_NAME)
export class Plan extends Table {
  @Field("string")
  declare _id: string;

  @Field("string")
  declare name: string;

  @Index()
  @Field("string")
  declare slug: string;

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
