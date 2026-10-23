import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  type BillingState,
  InvoiceModel,
  type Plan,
  PlanModel,
  type TenantBillingState,
  type TenantSubscription,
  type WorkspaceDirectoryFields,
  type WorkspaceOwnerStatus,
  type WorkspaceRenewalKind,
} from "../db";
import { getReportingCurrency } from "../config";
import {
  monthlyPlanAmountMinor,
  normalisedMrr,
  planUnitAmountMinor,
  reportingMajorUnits,
} from "../metrics/normalised-mrr";
import { type SeatUsage, getSeatUsage } from "../plans/seat-capacity";
import { MS_PER_DAY } from "../utils/time";
import {
  findPendingOwnerInvite,
  invitationStatusOf,
} from "../workspaces/invitations";
import { loadBillingSettings } from "../operator-billing/billing-settings-store";

/**
 * Who is leaving the workspace while the directory is recomputed: the DMS
 * runs its member and invitation removal hooks before it deletes the rows.
 */
export interface DirectoryDepartures {
  userIds?: readonly string[];
  inviteeEmail?: string;
}

/** The workspace owner as the directory lists them. */
export interface DirectoryOwner {
  status: WorkspaceOwnerStatus;
  name: string | null;
  email: string | null;
}

/** Billing rules that date a past-due suspension and a data deletion. */
export interface DirectoryPolicy {
  /** Days from past due to automatic suspension; null when it is off. */
  autoSuspendDelayDays: number | null;
  retentionDays: number;
}

/** Everything one directory row is derived from. */
export interface DirectoryInputs {
  billingState: BillingState;
  subscription: TenantSubscription | undefined;
  plan: Plan | null;
  seats: SeatUsage;
  owner: DirectoryOwner;
  policy: DirectoryPolicy;
  existing: TenantBillingState | undefined;
  /**
   * Whether the workspace ever paid an invoice for more than nothing: what
   * tells a paying customer's cancellation from a trial's. Only read when
   * the workspace is first published in a loss state (see
   * {@link shouldLookUpPaidInvoice}).
   */
  hasPaidInvoice: boolean;
  /** The currency the directory totals MRR in (uppercase ISO 4217). */
  reportingCurrency: string;
  now: Date;
}

interface RenewalDate {
  kind: WorkspaceRenewalKind;
  at: Date | null;
}

interface RenewalContext {
  subscription: TenantSubscription | undefined;
  policy: DirectoryPolicy;
  stateSince: Date;
}

const NO_OWNER: DirectoryOwner = { status: "none", name: null, email: null };

const PAID_INVOICE_STATUS = "paid";
const INVOICE_DOCUMENT_TYPE = "invoice";

// States a churn is read from: what the workspace paid before them is the
// loss. A suspension bills nothing but still holds the loss of the paying
// workspace it stopped, for the cancellation that usually follows.
const LOSS_STATES: ReadonlySet<BillingState> = new Set([
  "suspended",
  "cancelled",
]);
const LOSS_HOLDING_STATES: ReadonlySet<BillingState> = new Set(["suspended"]);

const OWNER_STATUS_BY_INVITATION: Record<string, WorkspaceOwnerStatus> = {
  pending: "invited",
  expired: "expired",
};

function addDays(date: Date | null | undefined, days: number): Date | null {
  return date ? new Date(new Date(date).getTime() + days * MS_PER_DAY) : null;
}

function datedBy(kind: WorkspaceRenewalKind, at: Date | null | undefined) {
  return at ? { kind, at: new Date(at) } : null;
}

const RENEWAL_BY_STATE: Record<
  BillingState,
  (context: RenewalContext) => RenewalDate | null
> = {
  active: ({ subscription }) =>
    datedBy("renews", subscription?.currentPeriodEnd),
  trialing: ({ subscription }) =>
    datedBy("trial_ends", subscription?.currentPeriodEnd),
  free: ({ subscription }) => datedBy("free_until", subscription?.freeUntil),
  past_due: ({ subscription, policy }) =>
    policy.autoSuspendDelayDays === null
      ? null
      : datedBy(
          "suspends",
          addDays(subscription?.pastDueSince, policy.autoSuspendDelayDays),
        ),
  suspended: ({ stateSince }) => datedBy("suspended", stateSince),
  pending_payment: ({ stateSince }) => datedBy("awaiting_payment", stateSince),
  cancelled: ({ subscription, policy }) =>
    datedBy("deletes", addDays(subscription?.updatedAt, policy.retentionDays)),
};

/**
 * When the current state began: kept while it holds, now when it changes,
 * and on a first pass the best record there is (the dunning clock, else the
 * subscription's last write).
 */
function resolveStateSince(inputs: DirectoryInputs): Date {
  const { existing, billingState, subscription, now } = inputs;
  if (existing?.billingState === billingState && existing.stateSince)
    return new Date(existing.stateSince);
  if (existing?.stateSince) return now;
  const recorded = subscription?.pastDueSince ?? subscription?.updatedAt;
  return recorded ? new Date(recorded) : now;
}

/**
 * What the workspace paid per month on the plan it is on, when it ever paid:
 * the loss of a workspace first published already suspended or cancelled
 * (an import, a seed), which no earlier publication saw billed.
 */
function lastPaidMrr(inputs: DirectoryInputs): number {
  const { plan, subscription, hasPaidInvoice, seats } = inputs;
  if (!hasPaidInvoice || !plan || plan.price <= 0) return 0;
  if (subscription?.isComplimentary === true) return 0;
  return monthlyPlanAmountMinor(plan, seats.occupied);
}

/**
 * The MRR the workspace had before its current state: what a churn lost. A
 * change of state takes the MRR the last publication had; a suspension
 * passes on the loss it held; and a workspace first published in a loss
 * state takes the price last paid.
 */
function resolvePreviousMrr(inputs: DirectoryInputs): number {
  const { existing, billingState } = inputs;
  if (!LOSS_STATES.has(billingState)) {
    if (existing && existing.billingState !== billingState)
      return existing.mrrMinor;
    return existing?.previousMrrMinor ?? 0;
  }
  if (!existing) return lastPaidMrr(inputs);
  if (existing.billingState === billingState) return existing.previousMrrMinor;
  if (existing.mrrMinor > 0) return existing.mrrMinor;
  if (!LOSS_HOLDING_STATES.has(existing.billingState)) return 0;
  return existing.previousMrrMinor;
}

/**
 * Whether {@link resolvePreviousMrr} needs the price last paid: a workspace
 * first published in a loss state. Spares the invoice read on every other
 * publication.
 */
export function shouldLookUpPaidInvoice(
  billingState: BillingState,
  existing: TenantBillingState | undefined,
): boolean {
  return LOSS_STATES.has(billingState) && !existing;
}

/** Whether the workspace ever paid an invoice for more than nothing. */
async function hasPaidInvoice(tenantId: string): Promise<boolean> {
  const rows = await GetModel(InvoiceModel, tenantId)
    .table.getAll(PAID_INVOICE_STATUS, "status")
    .filter((invoice) =>
      invoice
        .key("documentType")
        .eq(INVOICE_DOCUMENT_TYPE)
        .and(invoice.key("total").gt(0)),
    )
    .slice(0, 1)
    .run();
  return rows.length > 0;
}

function planFields(plan: Plan | null) {
  return {
    planId: plan?._id ?? null,
    planName: plan?.name ?? null,
    planInterval: plan?.interval ?? null,
    planBillingMode: plan?.billingMode ?? null,
    planUnitAmountMinor: plan ? planUnitAmountMinor(plan) : null,
    currency: plan?.currency ? plan.currency.toUpperCase() : null,
  };
}

/** The directory row of a workspace, derived from its current records. */
export function buildWorkspaceDirectoryFields(
  inputs: DirectoryInputs,
): WorkspaceDirectoryFields {
  const { subscription, plan, seats, owner, policy, billingState } = inputs;
  const isComplimentary = subscription?.isComplimentary === true;
  const stateSince = resolveStateSince(inputs);
  const renewal = RENEWAL_BY_STATE[billingState]({
    subscription,
    policy,
    stateSince,
  });
  const mrr = normalisedMrr({
    billingState,
    isComplimentary,
    plan,
    billedSeats: seats.occupied,
  });
  return {
    ...planFields(plan),
    seats: seats.occupied,
    members: seats.members,
    pendingPlanId: subscription?.pendingPlanId ?? null,
    isComplimentary,
    mrrMinor: mrr.amountMinor,
    previousMrrMinor: resolvePreviousMrr(inputs),
    reportingMrr: reportingMajorUnits(mrr, inputs.reportingCurrency),
    renewalKind: renewal?.kind ?? null,
    renewsAt: renewal?.at ?? null,
    stateSince,
    ownerStatus: owner.status,
    ownerNeverJoined: owner.status === "invited" || owner.status === "expired",
    ownerName: owner.name,
    ownerEmail: owner.email,
  };
}

async function loadJoinedOwner(
  tenantId: string,
  departures: DirectoryDepartures,
): Promise<DirectoryOwner | null> {
  const owners = await GetModel(TenantMemberModel, tenantId).listOwners();
  const owner = owners.find(
    (member) => !departures.userIds?.includes(member.userId),
  );
  if (!owner) return null;
  const user = await GetModel(UserModel).get(owner.userId);
  return {
    status: "joined",
    name: user?.name || null,
    email: user?.email ?? null,
  };
}

/**
 * The owner who joined, or else the invitee who will own the workspace once
 * they accept: a workspace created for a new account has no member yet.
 */
export async function loadDirectoryOwner(
  tenantId: string,
  now: Date = new Date(),
  departures: DirectoryDepartures = {},
): Promise<DirectoryOwner> {
  const joined = await loadJoinedOwner(tenantId, departures);
  if (joined) return joined;
  const invite = await findPendingOwnerInvite(tenantId);
  if (!invite || invite.email === departures.inviteeEmail) return NO_OWNER;
  return {
    status: OWNER_STATUS_BY_INVITATION[invitationStatusOf(invite, now)],
    name: null,
    email: invite.email,
  };
}

/** The billing rules the directory dates its renewals with. */
async function loadDirectoryPolicy(): Promise<DirectoryPolicy> {
  const settings = await loadBillingSettings();
  return {
    autoSuspendDelayDays: settings.autoSuspendEnabled
      ? settings.autoSuspendDelayDays
      : null,
    retentionDays: settings.dataRetentionDaysAfterCancellation,
  };
}

/** Reads what the directory row of a workspace is derived from, and derives it. */
export async function loadWorkspaceDirectoryFields(
  tenantId: string,
  billingState: BillingState,
  subscription: TenantSubscription | undefined,
  existing: TenantBillingState | undefined,
  departures: DirectoryDepartures = {},
): Promise<WorkspaceDirectoryFields> {
  const now = new Date();
  const [plan, seats, owner, policy, paid] = await Promise.all([
    subscription?.planId
      ? GetModel(PlanModel).get(subscription.planId)
      : undefined,
    getSeatUsage(tenantId, departures.inviteeEmail, departures.userIds),
    loadDirectoryOwner(tenantId, now, departures),
    loadDirectoryPolicy(),
    shouldLookUpPaidInvoice(billingState, existing)
      ? hasPaidInvoice(tenantId)
      : false,
  ]);
  return buildWorkspaceDirectoryFields({
    billingState,
    subscription,
    plan: plan ?? null,
    seats,
    owner,
    policy,
    existing,
    hasPaidInvoice: paid,
    reportingCurrency: getReportingCurrency(),
    now,
  });
}
