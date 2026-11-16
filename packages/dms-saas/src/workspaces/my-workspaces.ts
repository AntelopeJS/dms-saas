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
  owners: TenantMember[];
  membersCount: number;
}

async function loadFacts(tenant: Tenant): Promise<WorkspaceFacts> {
  const memberModel = GetModel(TenantMemberModel, tenant._id);
  const [subscription, owners, membersCount] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenant._id).findOne(),
    memberModel.listOwners(),
    memberModel.table.count().run(),
  ]);
  return { tenant, subscription, owners, membersCount };
}

async function resolvePlanName(
  subscription: TenantSubscription | undefined,
): Promise<string | null> {
  if (!subscription?.planId) return null;
  const plan = await GetModel(PlanModel).get(subscription.planId);
  return plan?.name ?? null;
}

async function resolveOwnerName(
  owners: TenantMember[],
): Promise<string | null> {
  const [owner] = owners;
  if (!owner) return null;
  const user = await GetModel(UserModel).get(owner.userId);
  return user?.name || user?.email || null;
}

async function toRow(
  facts: WorkspaceFacts,
  userId: string,
  currentTenantId: string,
): Promise<MyWorkspaceRow> {
  const { tenant, subscription, owners, membersCount } = facts;
  const [planName, ownerName] = await Promise.all([
    resolvePlanName(subscription),
    resolveOwnerName(owners),
  ]);
  return {
    _id: tenant._id,
    name: tenant.name,
    planName,
    status: deriveBillingState(subscription),
    isComplimentary: !!subscription?.isComplimentary,
    membersCount,
    ownerName,
    isOwner: owners.some((owner) => owner.userId === userId),
    isCurrent: tenant._id === currentTenantId,
  };
}

function compareRows(a: MyWorkspaceRow, b: MyWorkspaceRow): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Whether the switcher lists a workspace. A cancelled workspace lives on until
 * the retention cron deletes it, but switching to it only reaches the
 * access-restricted screen, so it is left out, unless the caller is in it:
 * resubscribing happens there, and an empty switcher hid the way out.
 */
function isListed(fact: WorkspaceFacts, currentTenantId: string): boolean {
  return (
    fact.subscription?.status !== CANCELLED_STATUS ||
    fact.tenant._id === currentTenantId
  );
}

/** The workspaces a user belongs to, current first, then by name. */
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
  const live = facts.filter((fact) => isListed(fact, currentTenantId));
  const rows = await Promise.all(
    live.map((fact) => toRow(fact, userId, currentTenantId)),
  );
  return rows.sort(compareRows);
}
