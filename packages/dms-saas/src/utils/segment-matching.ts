import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  type Tenant,
  TenantMemberModel,
  TenantModel,
} from "@antelopejs/interface-dms/db";
import {
  SessionModel,
  type User,
  UserModel,
} from "@antelopejs/interface-dms/auth/db";
import {
  type Invoice,
  InvoiceModel,
  type Plan,
  PlanModel,
  type Segment,
  SegmentModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
  UserSegmentModel,
} from "../db";
import { getRowInstance } from "./row-instance";
import { evaluateSegmentGroup } from "./segment-evaluator";
import { MS_PER_DAY } from "./time";

const PAID_STATUS = "paid";
const TRIALING_STATUS = "trialing";
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export interface WorkspaceProjection {
  _id: string;
  name: string;
  createdAt: Date;
  ageInDays: number;
  status: TenantSubscription["status"] | null;
  hasSubscription: boolean;
  hasStripeCustomer: boolean;
  isOnTrial: boolean;
  isFreeAccess: boolean;
  planId: string | null;
  planName: string | null;
  currency: string;
  mrr: number;
  isPaying: boolean;
  customerType: TenantBillingInfo["customerType"] | null;
  membersCount: number;
  totalRevenue: number;
  daysSinceLastInvoice: number | null;
}

interface ProjectionInputs {
  tenant: Tenant;
  subscription: TenantSubscription | undefined;
  billingInfo: TenantBillingInfo | undefined;
  plan: Plan | null;
  membersCount: number;
  invoices: Invoice[];
  now: Date;
}

function diffInDays(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function projectInvoices(invoices: Invoice[]): {
  totalRevenue: number;
  lastInvoiceAt: Date | null;
} {
  let totalRevenue = 0;
  let lastInvoiceAt: Date | null = null;
  for (const invoice of invoices) {
    if (invoice.status === PAID_STATUS) {
      totalRevenue += invoice.amount;
    }
    const issuedAt = new Date(invoice.issuedAt);
    if (!lastInvoiceAt || issuedAt > lastInvoiceAt) {
      lastInvoiceAt = issuedAt;
    }
  }
  return { totalRevenue, lastInvoiceAt };
}

export function buildWorkspaceProjection(
  inputs: ProjectionInputs,
): WorkspaceProjection {
  const {
    tenant,
    subscription,
    billingInfo,
    plan,
    membersCount,
    invoices,
    now,
  } = inputs;
  const status = subscription?.status ?? null;
  const isBilled = status ? ACTIVE_STATUSES.has(status) : false;
  const mrr = isBilled && plan ? plan.price : 0;
  const { totalRevenue, lastInvoiceAt } = projectInvoices(invoices);

  return {
    _id: tenant._id,
    name: tenant.name,
    createdAt: tenant.createdAt,
    ageInDays: diffInDays(new Date(tenant.createdAt), now),
    status,
    hasSubscription: !!subscription,
    hasStripeCustomer: !!subscription?.stripeCustomerId,
    isOnTrial: status === TRIALING_STATUS,
    isFreeAccess:
      !!subscription?.freeUntil && new Date(subscription.freeUntil) > now,
    planId: subscription?.planId ?? null,
    planName: plan?.name ?? null,
    currency: plan?.currency ?? "EUR",
    mrr,
    isPaying: mrr > 0,
    customerType: billingInfo?.customerType ?? null,
    membersCount,
    totalRevenue,
    daysSinceLastInvoice: lastInvoiceAt ? diffInDays(lastInvoiceAt, now) : null,
  };
}

export async function loadWorkspaceProjection(
  tenant: Tenant,
  planModel: PlanModel,
  now: Date = new Date(),
  plansById?: ReadonlyMap<string, Plan>,
): Promise<WorkspaceProjection> {
  const tenantId = tenant._id;
  const subscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const billingInfoModel = GetModel(TenantBillingInfoModel, tenantId);
  const memberModel = GetModel(TenantMemberModel, tenantId);
  const invoiceModel = GetModel(InvoiceModel, tenantId);

  const [subscription, billingInfo, members, invoices] = await Promise.all([
    subscriptionModel.findOne(),
    billingInfoModel.findOne(),
    memberModel.listAll(),
    invoiceModel.getAllInvoices(),
  ]);

  let plan: Plan | null = null;
  if (subscription?.planId) {
    plan =
      plansById?.get(subscription.planId) ??
      (await planModel.get(subscription.planId)) ??
      null;
  }

  return buildWorkspaceProjection({
    tenant,
    subscription,
    billingInfo,
    plan,
    membersCount: members.length,
    invoices,
    now,
  });
}

const PROJECTION_CONCURRENCY = 8;

export async function loadAllTenantProjections(
  planModel: PlanModel,
  now: Date = new Date(),
): Promise<WorkspaceProjection[]> {
  const tenantModel = GetModel(TenantModel, CROSS_INSTANCE);
  const [tenants, plans] = await Promise.all([
    tenantModel.getAll(),
    planModel.getAll(),
  ]);
  const plansById = new Map(plans.map((p) => [p._id, p]));
  const projections: WorkspaceProjection[] = [];
  for (let i = 0; i < tenants.length; i += PROJECTION_CONCURRENCY) {
    const batch = tenants.slice(i, i + PROJECTION_CONCURRENCY);
    const results = await Promise.all(
      batch.map((tenant) =>
        loadWorkspaceProjection(tenant, planModel, now, plansById),
      ),
    );
    projections.push(...results);
  }
  return projections;
}

/** Workspace projection seen from a user: carries the membership role. */
export type UserWorkspaceProjection = WorkspaceProjection & {
  isOwner: boolean;
};

// A type alias rather than an interface: TypeScript gives aliases an implicit
// index signature, which is what lets a projection be read as a dictionary by
// the segment evaluator without an assertion.
export type UserProjection = {
  _id: string;
  email: string;
  name: string;
  language: string;
  createdAt: Date;
  ageInDays: number;
  isValidated: boolean;
  daysSinceLastActive: number | null;
  workspacesCount: number;
  isOwnerOfAnyWorkspace: boolean;
  /** Projections of the workspaces the user is a member of (workspaceRef nodes). */
  workspaces: UserWorkspaceProjection[];
};

interface UserMembership {
  tenantId: string;
  isTenantOwner: boolean;
}

function buildUserProjection(
  user: User,
  memberships: readonly UserMembership[],
  lastActiveAt: Date | undefined,
  workspacesById: ReadonlyMap<string, WorkspaceProjection>,
  now: Date,
): UserProjection {
  const workspaces = memberships
    .map((m) => {
      const projection = workspacesById.get(m.tenantId);
      return projection
        ? { ...projection, isOwner: m.isTenantOwner }
        : undefined;
    })
    .filter((w): w is UserWorkspaceProjection => w !== undefined);

  return {
    _id: user._id,
    email: user.email,
    name: user.name ?? "",
    language: user.language ?? "",
    createdAt: user.createdAt,
    ageInDays: diffInDays(new Date(user.createdAt), now),
    isValidated: !!user.isValidated,
    daysSinceLastActive: lastActiveAt ? diffInDays(lastActiveAt, now) : null,
    workspacesCount: memberships.length,
    isOwnerOfAnyWorkspace: memberships.some((m) => m.isTenantOwner),
    workspaces,
  };
}

/**
 * Build the projection of every user from already-loaded workspace
 * projections. Loads users, sessions (last activity) and cross-instance
 * memberships in parallel.
 */
export async function loadUserProjectionsFrom(
  workspaceProjections: readonly WorkspaceProjection[],
  now: Date = new Date(),
): Promise<UserProjection[]> {
  const userModel = GetModel(UserModel);
  const sessionModel = GetModel(SessionModel);
  const memberModel = GetModel(TenantMemberModel, CROSS_INSTANCE);

  // Server-side group-max: only one (userId, lastActiveAt) pair per user is
  // transferred instead of every session row.
  const [users, sessionActivity, memberRows] = await Promise.all([
    userModel.getAll(),
    sessionModel.table
      .group("userId", (stream, userId) => ({
        userId,
        lastActiveAt: stream.max("lastActiveAt"),
      }))
      .run(),
    memberModel.table.run(),
  ]);

  const lastActiveByUser = new Map<string, Date>();
  for (const entry of sessionActivity) {
    if (entry.lastActiveAt === null || entry.lastActiveAt === undefined) {
      continue;
    }
    lastActiveByUser.set(entry.userId, new Date(entry.lastActiveAt));
  }

  const membershipsByUser = new Map<string, UserMembership[]>();
  for (const row of memberRows) {
    const member = TenantMemberModel.fromDatabase(row);
    if (!member) continue;
    const tenantId = getRowInstance(row);
    const list = membershipsByUser.get(member.userId) ?? [];
    list.push({ tenantId, isTenantOwner: !!member.isTenantOwner });
    membershipsByUser.set(member.userId, list);
  }

  const workspacesById = new Map(workspaceProjections.map((p) => [p._id, p]));
  return users.map((user) =>
    buildUserProjection(
      user,
      membershipsByUser.get(user._id) ?? [],
      lastActiveByUser.get(user._id),
      workspacesById,
      now,
    ),
  );
}

export async function loadAllUserProjections(
  planModel: PlanModel,
  now: Date = new Date(),
): Promise<UserProjection[]> {
  const workspaceProjections = await loadAllTenantProjections(planModel, now);
  return loadUserProjectionsFrom(workspaceProjections, now);
}

const SEGMENT_RECOMPUTE_CONCURRENCY = 4;

/**
 * Re-evaluate the given segments against all users and persist the result:
 * updates `estimatedCount` + `lastEvaluatedAt` on each segment and rebuilds
 * the `user_segments` links. Shared by the cron and the create/edit handlers.
 */
export async function recomputeSegments(
  segments: readonly Segment[],
): Promise<void> {
  if (segments.length === 0) return;
  const planModel = GetModel(PlanModel);
  const userSegmentModel = GetModel(UserSegmentModel);

  const now = new Date();
  const userProjections = await loadAllUserProjections(planModel, now);

  for (let i = 0; i < segments.length; i += SEGMENT_RECOMPUTE_CONCURRENCY) {
    const batch = segments.slice(i, i + SEGMENT_RECOMPUTE_CONCURRENCY);
    await Promise.all(
      batch.map(async (segment) => {
        const matchedIds = userProjections
          .filter((projection) =>
            evaluateSegmentGroup(segment.conditions, projection),
          )
          .map((projection) => projection._id);

        await userSegmentModel.replaceForSegment(segment, matchedIds, now);
      }),
    );
  }
}

export async function recomputeAllSegments(): Promise<void> {
  const segments = await GetModel(SegmentModel).getAll();
  await recomputeSegments(segments);
}

export async function recomputeSegmentsByIds(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const segments = await GetModel(SegmentModel).getMany(ids);
  await recomputeSegments(segments);
}
