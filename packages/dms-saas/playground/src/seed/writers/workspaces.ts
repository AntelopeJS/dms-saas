import { randomBytes, randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type BillingState,
  type PaidUsagePeriod,
  type TenantSubscription,
  TenantBillingInfoModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
  type VatVerificationStatus,
} from "@antelopejs/interface-dms-saas/db";
import {
  RoleModel,
  TenantMemberModel,
  TenantModel,
  UserInviteModel,
} from "@antelopejs/interface-dms/db";
import type {
  DayOffset,
  SeedBillingProfile,
  SeedInvitation,
  SeedMember,
  SeedSubscription,
  SeedWorkspace,
} from "../data/types";
import { dayFrom, insertMissing, optionalDayFrom, type SeedRow } from "./rows";

const MEMBER_ROLE_SUFFIX = "member";
const INVITE_TOKEN_BYTES = 32;
const INVITE_LANGUAGE = "en";
const ACTIVE_STATUS = "active";
const FREE_STATE: BillingState = "free";
const VAT_VERIFIED: VatVerificationStatus = "verified";

/** Tenant rows share one collection, so their ids carry the tenant. */
function memberRoleId(tenantId: string): string {
  return `${tenantId}:${MEMBER_ROLE_SUFFIX}`;
}

function memberRole(
  tenantId: string,
  permissions: string[],
  createdOn: DayOffset,
): SeedRow {
  const createdAt = dayFrom(createdOn);
  return {
    _id: memberRoleId(tenantId),
    name: "Member",
    description: "Everything the workspace plan includes",
    permissions,
    createdAt,
    updatedAt: createdAt,
  };
}

function toMemberRow(tenantId: string, member: SeedMember): SeedRow {
  return {
    _id: `${tenantId}:${member.userId}`,
    userId: member.userId,
    roleIds: member.isTenantOwner ? [] : [memberRoleId(tenantId)],
    isTenantOwner: member.isTenantOwner,
    joinedAt: dayFrom(member.joinedOn),
    invitedBy: null,
  };
}

function toInvitationRow(
  tenantId: string,
  invitation: SeedInvitation,
): SeedRow {
  return {
    _id: `${tenantId}:${invitation.email}`,
    email: invitation.email,
    firstname: invitation.firstname,
    lastname: invitation.lastname,
    roles_ids: invitation.asTenantOwner ? [] : [memberRoleId(tenantId)],
    language: INVITE_LANGUAGE,
    token: randomBytes(INVITE_TOKEN_BYTES).toString("hex"),
    asTenantOwner: invitation.asTenantOwner,
    expiresAt: dayFrom(invitation.expiresOn),
    skipEmailValidation: false,
    invitedBy: invitation.invitedBy,
    extensions: null,
    createdAt: dayFrom(invitation.sentOn),
  };
}

function paidUsagePeriods(
  subscription: SeedSubscription,
  startedAt: Date,
): PaidUsagePeriod[] {
  const { stripeSubscriptionId } = subscription;
  if (!stripeSubscriptionId) return [];
  return [{ stripeSubscriptionId, start: startedAt, end: null }];
}

function toSubscriptionRow(workspace: SeedWorkspace): SeedRow {
  const { subscription } = workspace;
  const createdAt = dayFrom(workspace.createdOn);
  const isPaid = !!subscription.stripeSubscriptionId;
  return {
    ...subscription,
    _id: workspace.id,
    revision: randomUUID(),
    currentPeriodEnd: optionalDayFrom(subscription.currentPeriodEndOn),
    freeUntil: optionalDayFrom(subscription.freeUntilOn),
    pastDueSince: optionalDayFrom(subscription.pastDueSinceOn),
    paidUsageStartedAt: isPaid ? createdAt : null,
    paidUsagePeriods: paidUsagePeriods(subscription, createdAt),
    stripeCheckoutSessionId: null,
    completedCheckoutSessionId: null,
    pendingPlanId: null,
    pendingPlanChangeAt: null,
    domainTransition: null,
    deletionStartedAt: null,
    cronNotification: null,
    refundRequestedAt: null,
    createdAt,
    updatedAt: dayFrom(subscription.updatedOn),
  };
}

function toBillingInfoRow(
  tenantId: string,
  profile: SeedBillingProfile,
): SeedRow {
  return {
    ...profile,
    _id: tenantId,
    vatVerificationStatus: profile.vatNumber ? VAT_VERIFIED : null,
  };
}

/** The rule of dms-saas `deriveBillingState`: a local, Stripe-less plan reads as free. */
function deriveBillingState(subscription: TenantSubscription): BillingState {
  if (
    subscription.status === ACTIVE_STATUS &&
    !subscription.stripeSubscriptionId
  ) {
    return FREE_STATE;
  }
  return subscription.status;
}

/**
 * Publishes the billing state the way dms-saas does. Its own recompute ran
 * before this seed in the same start, and its cron repeats it every 15
 * minutes with the same outcome.
 */
async function publishBillingState(tenantId: string): Promise<void> {
  const subscription = await GetModel(
    TenantSubscriptionModel,
    tenantId,
  ).findOne();
  if (!subscription) return;
  const states = GetModel(TenantBillingStateModel);
  const existing = await states.findByTenant(tenantId);
  await states.upsertForTenant(
    tenantId,
    deriveBillingState(subscription),
    existing,
  );
}

async function writeWorkspace(
  workspace: SeedWorkspace,
  permissions: string[],
): Promise<void> {
  const { id } = workspace;
  const createdAt = dayFrom(workspace.createdOn);
  await insertMissing(TenantModel, [
    { _id: id, name: workspace.name, createdAt, updatedAt: createdAt },
  ]);
  await insertMissing(
    RoleModel,
    [memberRole(id, permissions, workspace.createdOn)],
    id,
  );
  await insertMissing(
    TenantMemberModel,
    workspace.members.map((member) => toMemberRow(id, member)),
    id,
  );
  await insertMissing(
    UserInviteModel,
    workspace.invitations.map((invitation) => toInvitationRow(id, invitation)),
    id,
  );
  await insertMissing(
    TenantSubscriptionModel,
    [toSubscriptionRow(workspace)],
    id,
  );
  if (workspace.billingProfile) {
    await insertMissing(
      TenantBillingInfoModel,
      [toBillingInfoRow(id, workspace.billingProfile)],
      id,
    );
  }
  await publishBillingState(id);
}

/**
 * Writes each workspace with its members, invitations, subscription and
 * billing identity. Rows go straight to the tables: the membership hooks
 * would sync seat counts with Stripe, which the playground does not reach.
 */
export async function writeWorkspaces(
  workspaces: SeedWorkspace[],
  permissions: string[],
): Promise<void> {
  for (const workspace of workspaces) {
    await writeWorkspace(workspace, permissions);
  }
}
