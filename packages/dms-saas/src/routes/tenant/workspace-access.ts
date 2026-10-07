import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel, Model } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { type User, UserModel } from "@antelopejs/interface-dms/auth/db";
import { BLOCKING_STATUSES } from "../../auth";
import { toUnpaidInvoiceRef, type UnpaidInvoiceRef } from "../../billing-state";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  type BillingSettings,
  BillingSettingsModel,
  DEFAULT_AUTO_SUSPEND_DELAY_DAYS,
  DEFAULT_DATA_RETENTION_DAYS,
  type Invoice,
  InvoiceModel,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  type TenantSubscriptionStatus,
} from "../../db";
import { MS_PER_DAY } from "../../utils/time";
import {
  canRecoverComplimentarySubscription,
  isComplimentarySubscription,
} from "../../workspaces/complimentary";

/** Why a workspace refuses its members, as the restricted screen words it. */
export type AccessBlockReason =
  | "suspended"
  | "pending_payment"
  | "cancelled"
  | "complimentary_expired";

/** One dated step of how the workspace came to be blocked. */
export type AccessTimelineKind =
  | "invoice_issued"
  | "payment_failed"
  | "complimentary_ended"
  | "suspended"
  | "awaiting_payment"
  | "cancelled"
  | "data_deleted";

export interface AccessTimelineEntry {
  kind: AccessTimelineKind;
  at: Date;
  /** Still to come: the screen words it as a deadline. */
  isUpcoming: boolean;
}

/** The dunning and retention rules the timeline is computed from. */
export interface AccessTimelineRules {
  /** Null when the operator turned automatic suspension off. */
  autoSuspendDelayDays: number | null;
  dataRetentionDays: number;
}

export interface WorkspaceOwnerContact {
  name: string | null;
  email: string;
}

export interface OtherWorkspace {
  _id: string;
  name: string;
  planName: string | null;
  status: TenantSubscriptionStatus | null;
  isTenantOwner: boolean;
}

export interface BlockedWorkspaceSummary {
  _id: string;
  name: string;
  planName: string | null;
  memberCount: number;
}

/**
 * Everything the "Workspace access restricted" screen needs in one read:
 * why, since when and until when, what the caller can do about it, who to
 * ask otherwise, and where else they can go.
 */
export interface WorkspaceAccessDetails {
  blocked: boolean;
  reason: AccessBlockReason | null;
  workspace: BlockedWorkspaceSummary;
  isTenantOwner: boolean;
  owners: WorkspaceOwnerContact[];
  /** Owner-only: it carries the payment link. */
  unpaidInvoice: UnpaidInvoiceRef | null;
  /** Owner-only: a Stripe customer the billing portal can open. */
  canManageInStripe: boolean;
  timeline: AccessTimelineEntry[];
  /** When a cancelled workspace's data goes; null while nothing is scheduled. */
  dataDeletionAt: Date | null;
  otherWorkspaces: OtherWorkspace[];
}

const CANCELLED_STATUS: TenantSubscriptionStatus = "cancelled";
const SUSPENDED_STATUS: TenantSubscriptionStatus = "suspended";

/**
 * Why the workspace is blocked, or null when it is not. A suspension that
 * follows the end of complimentary access reads differently from one that
 * follows a failed payment: there is no invoice to pay, a plan to choose.
 *
 * @param subscription The workspace's subscription
 * @param now Reference time
 */
export function resolveAccessBlockReason(
  subscription: TenantSubscription | undefined,
  now = new Date(),
): AccessBlockReason | null {
  if (!subscription || !BLOCKING_STATUSES.has(subscription.status)) {
    return null;
  }
  const isEndedGift =
    subscription.status === SUSPENDED_STATUS &&
    canRecoverComplimentarySubscription(subscription, now);
  return isEndedGift
    ? "complimentary_expired"
    : (subscription.status as AccessBlockReason);
}

/**
 * The timeline rules with the defaults the billing code applies to settings
 * that were never saved.
 *
 * @param settings Billing settings singleton, when it exists
 */
export function toAccessTimelineRules(
  settings: BillingSettings | undefined,
): AccessTimelineRules {
  const isAutoSuspendOn = settings?.autoSuspendEnabled ?? true;
  return {
    autoSuspendDelayDays: isAutoSuspendOn
      ? (settings?.autoSuspendDelayDays ?? DEFAULT_AUTO_SUSPEND_DELAY_DAYS)
      : null,
    dataRetentionDays:
      settings?.dataRetentionDaysAfterCancellation ??
      DEFAULT_DATA_RETENTION_DAYS,
  };
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * The deletion date of a cancelled workspace: the retention cron deletes it
 * once its subscription has not changed for the retention period.
 *
 * @param subscription The workspace's subscription
 * @param rules Retention rule
 */
export function resolveDataDeletionAt(
  subscription: TenantSubscription | undefined,
  rules: AccessTimelineRules,
): Date | null {
  if (subscription?.status !== CANCELLED_STATUS) return null;
  return addDays(new Date(subscription.updatedAt), rules.dataRetentionDays);
}

type TimelineStep = [AccessTimelineKind, Date | null | undefined];

function suspensionDate(
  subscription: TenantSubscription,
  rules: AccessTimelineRules,
): Date | null {
  if (!subscription.pastDueSince || rules.autoSuspendDelayDays === null) {
    return null;
  }
  return addDays(
    new Date(subscription.pastDueSince),
    rules.autoSuspendDelayDays,
  );
}

const TIMELINE_STEPS: Record<
  AccessBlockReason,
  (
    subscription: TenantSubscription,
    rules: AccessTimelineRules,
    invoice: Invoice | undefined,
  ) => TimelineStep[]
> = {
  suspended: (subscription, rules, invoice) => [
    ["invoice_issued", invoice?.issuedAt],
    ["payment_failed", subscription.pastDueSince],
    ["suspended", suspensionDate(subscription, rules)],
  ],
  complimentary_expired: (subscription, rules) => [
    ["complimentary_ended", subscription.freeUntil],
    ["suspended", suspensionDate(subscription, rules)],
  ],
  pending_payment: (subscription) => [
    ["awaiting_payment", subscription.createdAt],
  ],
  cancelled: (subscription, rules) => [
    ["cancelled", subscription.updatedAt],
    ["data_deleted", resolveDataDeletionAt(subscription, rules)],
  ],
};

/**
 * How the workspace came to be blocked, oldest first, with the deadlines
 * still to come. The invoice step is only given to the workspace owner.
 *
 * @param reason Why the workspace is blocked
 * @param subscription The workspace's subscription
 * @param rules Dunning and retention rules
 * @param invoice The unpaid invoice, for the workspace owner only
 * @param now Reference time
 */
export function buildAccessTimeline(
  reason: AccessBlockReason,
  subscription: TenantSubscription,
  rules: AccessTimelineRules,
  invoice: Invoice | undefined,
  now = new Date(),
): AccessTimelineEntry[] {
  return TIMELINE_STEPS[reason](subscription, rules, invoice)
    .filter((step): step is [AccessTimelineKind, Date] => !!step[1])
    .map(([kind, at]) => {
      const date = new Date(at);
      return { kind, at: date, isUpcoming: date.getTime() > now.getTime() };
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());
}

/** The caller's workspaces besides the blocked one, cancelled ones left out. */
export function selectOtherWorkspaces(
  workspaces: OtherWorkspace[],
  currentTenantId: string,
): OtherWorkspace[] {
  return workspaces.filter(
    (workspace) =>
      workspace._id !== currentTenantId &&
      workspace.status !== CANCELLED_STATUS,
  );
}

interface BlockedWorkspaceState {
  subscription: TenantSubscription | undefined;
  members: TenantMember[];
  settings: BillingSettings | undefined;
}

async function loadBlockedWorkspaceState(
  tenantId: string,
): Promise<BlockedWorkspaceState> {
  const [subscription, members, settings] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetModel(TenantMemberModel, tenantId).listAll(),
    GetModel(BillingSettingsModel).get(BILLING_SETTINGS_SINGLETON_ID),
  ]);
  return { subscription, members, settings };
}

/** The open invoice a blocked owner can pay; only a suspension has one. */
async function loadSettleableInvoice(
  tenantId: string,
  reason: AccessBlockReason | null,
  isTenantOwner: boolean,
): Promise<Invoice | undefined> {
  if (!isTenantOwner || reason !== SUSPENDED_STATUS) return undefined;
  return GetModel(InvoiceModel, tenantId).findLatestOpen();
}

export class SaasWorkspaceAccessController extends Controller(
  "/api/saas/workspace-access",
) {
  @Model(TenantModel)
  declare tenantModel: TenantModel;

  @Model(PlanModel)
  declare planModel: PlanModel;

  @Model(UserModel)
  declare userModel: UserModel;

  private async loadPlanName(
    subscription: TenantSubscription | undefined,
  ): Promise<string | null> {
    if (!subscription?.planId) return null;
    return (await this.planModel.get(subscription.planId))?.name ?? null;
  }

  private async loadOwnerContacts(
    members: TenantMember[],
  ): Promise<WorkspaceOwnerContact[]> {
    const owners = members.filter((member) => member.isTenantOwner);
    const users = await Promise.all(
      owners.map((owner) => this.userModel.get(owner.userId)),
    );
    return users.flatMap((user) =>
      user ? [{ name: user.name || null, email: user.email }] : [],
    );
  }

  private async describeWorkspace(
    tenantId: string,
  ): Promise<OtherWorkspace | null> {
    const tenant = await this.tenantModel.get(tenantId);
    if (!tenant) return null;
    const subscription = await GetModel(
      TenantSubscriptionModel,
      tenantId,
    ).findOne();
    return {
      _id: tenant._id,
      name: tenant.name,
      planName: await this.loadPlanName(subscription),
      status: subscription?.status ?? null,
      isTenantOwner: false,
    };
  }

  private async loadOtherWorkspaces(
    userId: string,
    currentTenantId: string,
  ): Promise<OtherWorkspace[]> {
    const memberships = await GetModel(
      TenantMemberModel,
      CROSS_INSTANCE,
    ).listByUserWithTenantIds(userId);
    const others = memberships.filter((m) => m.tenantId !== currentTenantId);
    const described = await Promise.all(
      others.map(async ({ tenantId, member }) => {
        const workspace = await this.describeWorkspace(tenantId);
        return workspace
          ? [{ ...workspace, isTenantOwner: member.isTenantOwner }]
          : [];
      }),
    );
    return selectOtherWorkspaces(described.flat(), currentTenantId);
  }

  /**
   * Read by the restricted screen. It bypasses the access gate, which is the
   * whole point: this is what a blocked member is shown instead of the
   * workspace. A workspace that is not blocked answers too, with `blocked`
   * false, so the screen can send the caller back in.
   */
  @Get("/")
  async getWorkspaceAccess(
    @Context() ctx: RequestContext,
    @AuthTenantMember({ bypassTenantAccessGate: true }) user: User,
  ): Promise<WorkspaceAccessDetails> {
    const tenantId = getRequestTenantId(ctx);
    const state = await loadBlockedWorkspaceState(tenantId);
    const reason = resolveAccessBlockReason(state.subscription);
    const isTenantOwner = state.members.some(
      (member) => member.userId === user._id && member.isTenantOwner,
    );
    const invoice = await loadSettleableInvoice(
      tenantId,
      reason,
      isTenantOwner,
    );
    const rules = toAccessTimelineRules(state.settings);
    return {
      blocked: reason !== null,
      reason,
      workspace: await this.summarizeWorkspace(tenantId, state),
      isTenantOwner,
      owners: await this.loadOwnerContacts(state.members),
      unpaidInvoice: invoice ? toUnpaidInvoiceRef(invoice) : null,
      canManageInStripe:
        isTenantOwner &&
        !!state.subscription?.stripeCustomerId &&
        !isComplimentarySubscription(state.subscription),
      timeline:
        reason && state.subscription
          ? buildAccessTimeline(reason, state.subscription, rules, invoice)
          : [],
      dataDeletionAt: resolveDataDeletionAt(state.subscription, rules),
      otherWorkspaces: await this.loadOtherWorkspaces(user._id, tenantId),
    };
  }

  private async summarizeWorkspace(
    tenantId: string,
    state: BlockedWorkspaceState,
  ): Promise<BlockedWorkspaceSummary> {
    const tenant = await this.tenantModel.get(tenantId);
    return {
      _id: tenantId,
      name: tenant?.name ?? "",
      planName: await this.loadPlanName(state.subscription),
      memberCount: state.members.length,
    };
  }
}
