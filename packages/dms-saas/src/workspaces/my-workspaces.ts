import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type Tenant,
  type TenantMember,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { deriveBillingState } from "../billing-state";
import {
  type BillingState,
  PlanModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";

const CANCELLED_STATUS = "cancelled";

/** One workspace of the switcher, as its row reads. */
export interface MyWorkspaceRow {
  _id: string;
  name: string;
  planName: string | null;
  status: BillingState;
  isComplimentary: boolean;
  membersCount: number;
  /** The first workspace owner's name, for the rows the caller does not own. */
  ownerName: string | null;
  isOwner: boolean;
  isCurrent: boolean;
}

interface WorkspaceFacts {
  tenant: Tenant;
  subscription: TenantSubscription | undefined;
  members: TenantMember[];
}

async function loadFacts(tenant: Tenant): Promise<WorkspaceFacts> {
  const [subscription, members] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenant._id).findOne(),
    GetModel(TenantMemberModel, tenant._id).listAll(),
  ]);
  return { tenant, subscription, members };
}

async function resolvePlanName(
  subscription: TenantSubscription | undefined,
): Promise<string | null> {
  if (!subscription?.planId) return null;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  return plan?.name ?? null;
}

async function resolveOwnerName(
  members: TenantMember[],
): Promise<string | null> {
  const owner = members.find((member) => member.isTenantOwner);
  if (!owner) return null;
  const user = await GetModel(UserModel).get(owner.userId);
  return user?.name || user?.email || null;
}

async function toRow(
  facts: WorkspaceFacts,
  userId: string,
  currentTenantId: string,
): Promise<MyWorkspaceRow> {
  const { tenant, subscription, members } = facts;
  const [planName, ownerName] = await Promise.all([
    resolvePlanName(subscription),
    resolveOwnerName(members),
  ]);
  return {
    _id: tenant._id,
    name: tenant.name,
    planName,
    status: deriveBillingState(subscription),
    isComplimentary: !!subscription?.isComplimentary,
    membersCount: members.length,
    ownerName,
    isOwner: members.some(
      (member) => member.userId === userId && member.isTenantOwner,
    ),
    isCurrent: tenant._id === currentTenantId,
  };
}

function compareRows(a: MyWorkspaceRow, b: MyWorkspaceRow): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The workspaces a user belongs to, current first, then by name. A cancelled
 * workspace lives on until the retention cron deletes it, but switching to it
 * only reaches the access-restricted screen, so it is left out.
 */
export async function listMyWorkspaces(
  userId: string,
  currentTenantId: string,
): Promise<MyWorkspaceRow[]> {
  const memberships = await GetModel(
    TenantMemberModel,
    CROSS_INSTANCE,
  ).listByUserWithTenantIds(userId);
  if (memberships.length === 0) return [];
  const tenants = await GetModel(TenantModel).getMany(
    memberships.map((membership) => membership.tenantId),
  );
  const facts = await Promise.all(tenants.map(loadFacts));
  const live = facts.filter(
    (fact) => fact.subscription?.status !== CANCELLED_STATUS,
  );
  const rows = await Promise.all(
    live.map((fact) => toRow(fact, userId, currentTenantId)),
  );
  return rows.sort(compareRows);
}
