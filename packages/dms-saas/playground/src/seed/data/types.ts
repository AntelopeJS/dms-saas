import type {
  CreditNoteStatus,
  CreditNoteType,
  FeatureValueType,
  InvoiceStatus,
  PlanAudience,
  PlanBillingMode,
  PlanInterval,
  PlanMigrationFailedWorkspace,
  PlanMigrationStatus,
  PlatformNoteTargetType,
  RefundStatus,
  SegmentConditionGroup,
  TenantBillingAddress,
  TenantCustomerType,
  TenantSubscriptionStatus,
} from "@antelopejs/interface-dms-saas/db";

/** Days from the moment the seed runs: negative is in the past. */
export type DayOffset = number;

/** One text per locale, e.g. `{ en: "Storage", fr: "Stockage" }`. */
export type LocalizedText = Record<string, string>;

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  language: string;
  isValidated: boolean;
  isPlatformAdmin: boolean;
  createdOn: DayOffset;
  /** Null for an account that never signed in. */
  lastActiveOn: DayOffset | null;
}

export interface SeedFeature {
  id: string;
  displayName: LocalizedText;
  description: string;
  tooltip: LocalizedText | null;
  valueType: FeatureValueType;
  defaultValue: unknown;
  unit: string | null;
  isDetailRow: boolean;
  order: number;
}

export interface SeedPlan {
  id: string;
  name: string;
  description: string;
  audience: PlanAudience;
  /** In major units of `currency`, as the plan editor stores it. */
  price: number;
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
  trialDays: number;
  /** -1 means unlimited members. */
  maxMembers: number;
  isPublic: boolean;
  isActive: boolean;
  order: number;
  borderLabel: string | null;
  inheritsFromPlanId: string | null;
  /** Fake Stripe ids suffix; null for a plan that never reached Stripe. */
  stripeKey: string | null;
  features: Record<string, unknown>;
}

export interface SeedMember {
  userId: string;
  isTenantOwner: boolean;
  joinedOn: DayOffset;
}

export interface SeedInvitation {
  email: string;
  firstname: string | null;
  lastname: string | null;
  asTenantOwner: boolean;
  sentOn: DayOffset;
  expiresOn: DayOffset;
  invitedBy: string;
}

export interface SeedSubscription {
  planId: string;
  status: TenantSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  cardFingerprint: string | null;
  currentPeriodEndOn: DayOffset | null;
  freeUntilOn: DayOffset | null;
  pastDueSinceOn: DayOffset | null;
  isComplimentary: boolean;
  /** Last status change; a cancelled workspace is deleted a retention period after it. */
  updatedOn: DayOffset;
  createdBy: string | null;
}

export interface SeedBillingProfile {
  customerType: TenantCustomerType;
  companyName: string | null;
  vatNumber: string | null;
  billingEmail: string;
  address: TenantBillingAddress;
}

export interface SeedWorkspace {
  id: string;
  name: string;
  createdOn: DayOffset;
  members: SeedMember[];
  invitations: SeedInvitation[];
  subscription: SeedSubscription;
  billingProfile: SeedBillingProfile | null;
}

export interface SeedInvoiceLine {
  description: string;
  quantity: number;
  /** In minor units, as Stripe reports it. */
  unitAmount: number;
}

export interface SeedInvoice {
  id: string;
  tenantId: string;
  planId: string | null;
  status: InvoiceStatus;
  currency: string;
  /** Percent of the subtotal. */
  taxRate: number;
  issuedOn: DayOffset;
  periodStartOn: DayOffset;
  periodEndOn: DayOffset;
  lines: SeedInvoiceLine[];
}

export interface SeedRefund {
  id: string;
  status: RefundStatus;
}

export interface SeedCreditNote {
  id: string;
  invoiceId: string;
  type: CreditNoteType;
  status: CreditNoteStatus;
  /** In minor units of the invoice currency. */
  amount: number;
  /** Stripe's reason code. */
  reason: string;
  /** The operator's explanation. */
  memo: string;
  issuedOn: DayOffset;
  refund: SeedRefund | null;
}

export interface SeedPlanMigration {
  id: string;
  fromPlanId: string;
  toPlanId: string;
  status: PlanMigrationStatus;
  tenantIds: string[];
  /** Workspaces moved so far; the failed ones are never counted. */
  processedWorkspaces: number;
  failedWorkspaces: PlanMigrationFailedWorkspace[];
  initiatedBy: string;
  startedOn: DayOffset;
  /** Minutes the run took; null while it runs. */
  durationMinutes: number | null;
}

export interface SeedSegment {
  id: string;
  name: string;
  description: string;
  conditions: SegmentConditionGroup;
}

export interface SeedPlatformNote {
  id: string;
  targetType: PlatformNoteTargetType;
  targetId: string;
  authorId: string;
  content: string;
  writtenOn: DayOffset;
}
