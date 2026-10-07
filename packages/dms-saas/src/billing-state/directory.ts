import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingState,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  DEFAULT_DATA_RETENTION_DAYS,
  type Plan,
  PlanModel,
  type TenantBillingState,
  type TenantSubscription,
  type WorkspaceDirectoryFields,
  type WorkspaceOwnerStatus,
  type WorkspaceRenewalKind,
} from "../db";
import { normalisedMrr, planUnitAmountMinor } from "../metrics/normalised-mrr";
import { countOccupiedSeats } from "../plans/seat-capacity";
import { MS_PER_DAY } from "../utils/time";
import {
  findPendingOwnerInvite,
  invitationStatusOf,
} from "../workspaces/invitations";

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
  seats: number;
  owner: DirectoryOwner;
  policy: DirectoryPolicy;
  existing: TenantBillingState | undefined;
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

function resolvePreviousMrr(inputs: DirectoryInputs): number {
  const { existing, billingState } = inputs;
  if (existing && existing.billingState !== billingState)
    return existing.mrrMinor ?? 0;
  return existing?.previousMrrMinor ?? 0;
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
    billedSeats: seats,
  });
  return {
    ...planFields(plan),
    seats,
    isComplimentary,
    mrrMinor: mrr.amountMinor,
    previousMrrMinor: resolvePreviousMrr(inputs),
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
): Promise<DirectoryOwner | null> {
  const [owner] = await GetModel(TenantMemberModel, tenantId).listOwners();
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
): Promise<DirectoryOwner> {
  const joined = await loadJoinedOwner(tenantId);
  if (joined) return joined;
  const invite = await findPendingOwnerInvite(tenantId);
  if (!invite) return NO_OWNER;
  return {
    status: OWNER_STATUS_BY_INVITATION[invitationStatusOf(invite, now)],
    name: null,
    email: invite.email,
  };
}

/** The billing rules the directory dates its renewals with. */
async function loadDirectoryPolicy(): Promise<DirectoryPolicy> {
  const settings = await GetModel(BillingSettingsModel).get(
    BILLING_SETTINGS_SINGLETON_ID,
  );
  return {
    autoSuspendDelayDays: settings?.autoSuspendEnabled
      ? (settings.autoSuspendDelayDays ?? DEFAULT_AUTO_SUSPEND_DELAY_DAYS)
      : null,
    retentionDays:
      settings?.dataRetentionDaysAfterCancellation ??
      DEFAULT_DATA_RETENTION_DAYS,
  };
}

/** Reads what the directory row of a workspace is derived from, and derives it. */
export async function loadWorkspaceDirectoryFields(
  tenantId: string,
  billingState: BillingState,
  subscription: TenantSubscription | undefined,
  existing: TenantBillingState | undefined,
): Promise<WorkspaceDirectoryFields> {
  const now = new Date();
  const [plan, seats, owner, policy] = await Promise.all([
    subscription?.planId
      ? GetModel(PlanModel).get(subscription.planId)
      : undefined,
    countOccupiedSeats(tenantId),
    loadDirectoryOwner(tenantId, now),
    loadDirectoryPolicy(),
  ]);
  return buildWorkspaceDirectoryFields({
    billingState,
    subscription,
    plan: plan ?? null,
    seats,
    owner,
    policy,
    existing,
    now,
  });
}
