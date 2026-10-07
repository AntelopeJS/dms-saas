import { assert } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type TenantMember,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { deriveBillingState } from "../billing-state";
import {
  type BillingState,
  InvoiceModel,
  type Plan,
  type PlanBillingMode,
  type PlanInterval,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { getSeatUsage } from "../plans";
import { MS_PER_DAY } from "../utils/time";
import { resolveDataRetentionDays } from "./deletion";
import { listMyWorkspaces } from "./my-workspaces";

const HTTP_NOT_FOUND = 404;
const UNLIMITED_SEATS = -1;

/** Seats as the members page counts them; `maxMembers` null when unlimited. */
export interface WorkspaceSeatsOverview {
  members: number;
  pendingInvites: number;
  occupied: number;
  maxMembers: number | null;
}

/** The plan in force and its state, as the "At a glance" card shows it. */
export interface WorkspacePlanOverview {
  name: string;
  status: BillingState;
  isComplimentary: boolean;
  /** Minor units. */
  price: number;
  currency: string;
  interval: PlanInterval;
  billingMode: PlanBillingMode;
  renewsAt: Date | null;
}

export interface WorkspaceOwnerOverview {
  userId: string;
  name: string;
  email: string;
  isCaller: boolean;
}

/** Where the caller lands once the workspace is deleted. */
export interface NextWorkspaceRef {
  _id: string;
  name: string;
}

/**
 * What the General page states about the workspace: who is in it, what it
 * pays, who owns it, and what deleting it does.
 */
export interface WorkspaceOverview {
  _id: string;
  name: string;
  createdAt: Date;
  seats: WorkspaceSeatsOverview;
  plan: WorkspacePlanOverview | null;
  owners: WorkspaceOwnerOverview[];
  invoicesCount: number;
  unpaidInvoiceNumber: string | null;
  retentionDays: number;
  /** When the data is destroyed if the workspace is deleted now. */
  destroyedAt: Date;
  nextWorkspace: NextWorkspaceRef | null;
}

function toPlanOverview(
  plan: Plan,
  subscription: TenantSubscription,
): WorkspacePlanOverview {
  return {
    name: plan.name,
    status: deriveBillingState(subscription),
    isComplimentary: subscription.isComplimentary,
    price: plan.price,
    currency: plan.currency,
    interval: plan.interval,
    billingMode: plan.billingMode,
    renewsAt: subscription.currentPeriodEnd ?? null,
  };
}

async function resolvePlan(
  subscription: TenantSubscription | undefined,
): Promise<Plan | null> {
  if (!subscription?.planId) return null;
  return (await GetModel(PlanModel).get(subscription.planId)) ?? null;
}

async function resolveOwners(
  members: TenantMember[],
  callerId: string,
): Promise<WorkspaceOwnerOverview[]> {
  const owners = members.filter((member) => member.isTenantOwner);
  const users = await Promise.all(
    owners.map((owner) => GetModel(UserModel).get(owner.userId)),
  );
  return owners.map((owner, index) => ({
    userId: owner.userId,
    name: users[index]?.name || users[index]?.email || owner.userId,
    email: users[index]?.email ?? "",
    isCaller: owner.userId === callerId,
  }));
}

function toSeats(
  usage: Awaited<ReturnType<typeof getSeatUsage>>,
  plan: Plan | null,
): WorkspaceSeatsOverview {
  const isLimited = !!plan && plan.maxMembers !== UNLIMITED_SEATS;
  return {
    members: usage.members,
    pendingInvites: usage.pendingInvites,
    occupied: usage.occupied,
    maxMembers: isLimited ? plan.maxMembers : null,
  };
}

async function resolveNextWorkspace(
  callerId: string,
  tenantId: string,
): Promise<NextWorkspaceRef | null> {
  const rows = await listMyWorkspaces(callerId, tenantId);
  const next = rows.find((row) => row._id !== tenantId);
  return next ? { _id: next._id, name: next.name } : null;
}

/**
 * Builds the General page's overview of a workspace for one of its owners.
 *
 * @throws 404 when the workspace does not exist
 */
export async function buildWorkspaceOverview(
  tenantId: string,
  callerId: string,
  now: Date = new Date(),
): Promise<WorkspaceOverview> {
  const tenant = await GetModel(TenantModel).get(tenantId);
  assert(tenant, HTTP_NOT_FOUND, "saas.errors.workspace.not_found");
  const invoiceModel = GetModel(InvoiceModel, tenantId);
  const [subscription, members, usage, invoices, unpaid, retentionDays, next] =
    await Promise.all([
      GetModel(TenantSubscriptionModel, tenantId).findOne(),
      GetModel(TenantMemberModel, tenantId).listAll(),
      getSeatUsage(tenantId),
      invoiceModel.getAllInvoices(),
      invoiceModel.findLatestOpen(),
      resolveDataRetentionDays(),
      resolveNextWorkspace(callerId, tenantId),
    ]);
  const plan = await resolvePlan(subscription);
  return {
    _id: tenant._id,
    name: tenant.name,
    createdAt: tenant.createdAt,
    seats: toSeats(usage, plan),
    plan: plan && subscription ? toPlanOverview(plan, subscription) : null,
    owners: await resolveOwners(members, callerId),
    invoicesCount: invoices.length,
    unpaidInvoiceNumber: unpaid?.number ?? null,
    retentionDays,
    destroyedAt: new Date(now.getTime() + retentionDays * MS_PER_DAY),
    nextWorkspace: next,
  };
}
