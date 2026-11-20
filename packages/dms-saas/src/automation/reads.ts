import { GetModel } from "@antelopejs/interface-database-decorators";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { loadDirectoryOwner } from "../billing-state/directory";
import {
  type BillingState,
  FeatureModel,
  type FeatureValue,
  type Plan,
  PlanModel,
  SegmentModel,
  type TenantBillingState,
  TenantBillingStateModel,
  TenantSubscriptionModel,
  UserSegmentModel,
  type WorkspaceOwnerStatus,
  type WorkspaceRenewalKind,
} from "../db";
import { GetTenantPlanConstraints } from "../implementations/dms-saas/plan-changes";
import { countOccupiedSeats } from "../plans/seat-capacity";
import { getUpcomingInvoicePreview } from "../upcoming-invoice/preview";

const UNLIMITED_MEMBERS = -1;

function isoOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/** A workspace's billing snapshot, as the workspace directory holds it. */
export type WorkspaceBillingRead = {
  found: boolean;
  tenantId: string;
  name: string | null;
  billingState: BillingState | null;
  planId: string | null;
  planName: string | null;
  planInterval: string | null;
  planBillingMode: string | null;
  pendingPlanId: string | null;
  isComplimentary: boolean;
  seats: number;
  members: number;
  mrrMinor: number;
  currency: string | null;
  renewalKind: WorkspaceRenewalKind | null;
  renewsAt: string | null;
  stateSince: string | null;
  ownerStatus: WorkspaceOwnerStatus;
};

function absentWorkspace(tenantId: string): WorkspaceBillingRead {
  return {
    found: false,
    tenantId,
    name: null,
    billingState: null,
    planId: null,
    planName: null,
    planInterval: null,
    planBillingMode: null,
    pendingPlanId: null,
    isComplimentary: false,
    seats: 0,
    members: 0,
    mrrMinor: 0,
    currency: null,
    renewalKind: null,
    renewsAt: null,
    stateSince: null,
    ownerStatus: "none",
  };
}

/** Reads a workspace's billing snapshot; `found` is false once it is deleted. */
export async function readWorkspaceBilling(
  tenantId: string,
): Promise<WorkspaceBillingRead> {
  const [row, tenant] = await Promise.all([
    GetModel(TenantBillingStateModel).findByTenant(tenantId),
    GetModel(TenantModel).get(tenantId),
  ]);
  if (!row || row.deletedAt) return absentWorkspace(tenantId);
  return {
    found: true,
    tenantId,
    name: tenant?.name ?? null,
    billingState: row.billingState,
    planId: row.planId,
    planName: row.planName,
    planInterval: row.planInterval,
    planBillingMode: row.planBillingMode,
    pendingPlanId: row.pendingPlanId,
    isComplimentary: row.isComplimentary,
    seats: row.seats,
    members: row.members,
    mrrMinor: row.mrrMinor,
    currency: row.currency,
    renewalKind: row.renewalKind,
    renewsAt: isoOrNull(row.renewsAt),
    stateSince: isoOrNull(row.stateSince),
    ownerStatus: row.ownerStatus,
  };
}

/** Who owns a workspace: the joined owner, or the invitee who will. */
export type WorkspaceOwnerRead = {
  found: boolean;
  status: WorkspaceOwnerStatus;
  userId: string | null;
  name: string | null;
  email: string | null;
  language: string | null;
};

/** Reads a workspace's owner, with the contact data mail to them needs. */
export async function readWorkspaceOwner(
  tenantId: string,
): Promise<WorkspaceOwnerRead> {
  const owner = await loadDirectoryOwner(tenantId);
  return {
    found: owner.status !== "none",
    status: owner.status,
    userId: owner.userId ?? null,
    name: owner.name,
    email: owner.email,
    language: owner.language ?? null,
  };
}

/** A workspace's plan limits and any scheduled or blocked change. */
export type PlanConstraintsRead = {
  found: boolean;
  planId: string | null;
  planName: string | null;
  maxMembers: number | null;
  occupiedSeats: number;
  seatsAvailable: number | null;
  features: Record<string, FeatureValue>;
  pendingPlanId: string | null;
  pendingPlanName: string | null;
  effectiveAt: string | null;
  blocked: boolean;
  admissionBlocked: boolean;
  incompatibilityCodes: string[];
};

async function resolvedFeatures(
  plan: Plan | null,
): Promise<Record<string, FeatureValue>> {
  const features = await GetModel(FeatureModel).getAll();
  const values: Record<string, FeatureValue> = Object.fromEntries(
    features.map((feature) => [feature._id, feature.defaultValue]),
  );
  if (!plan) return values;
  const resolved = await GetModel(PlanModel).resolveInheritance(plan);
  for (const { featureId, value } of resolved.features)
    values[featureId] = value;
  return values;
}

function seatsLeft(
  maxMembers: number | null,
  occupiedSeats: number,
): number | null {
  if (maxMembers === null || maxMembers === UNLIMITED_MEMBERS) return null;
  return Math.max(0, maxMembers - occupiedSeats);
}

/** Reads a workspace's plan limits; `found` is false without a subscription. */
export async function readPlanConstraints(
  tenantId: string,
): Promise<PlanConstraintsRead> {
  const [subscription, constraints, occupiedSeats] = await Promise.all([
    GetModel(TenantSubscriptionModel, tenantId).findOne(),
    GetTenantPlanConstraints(tenantId),
    countOccupiedSeats(tenantId),
  ]);
  const plan = constraints.currentPlan;
  const maxMembers = plan?.maxMembers ?? null;
  return {
    found: subscription !== undefined,
    planId: plan?._id ?? null,
    planName: plan?.name ?? null,
    maxMembers,
    occupiedSeats,
    seatsAvailable: seatsLeft(maxMembers, occupiedSeats),
    features: await resolvedFeatures(plan),
    pendingPlanId: constraints.pendingPlan?._id ?? null,
    pendingPlanName: constraints.pendingPlan?.name ?? null,
    effectiveAt: isoOrNull(constraints.effectiveAt),
    blocked: constraints.blocked,
    admissionBlocked: constraints.admissionBlocked,
    incompatibilityCodes: constraints.incompatibilities.map(
      (incompatibility) => incompatibility.code,
    ),
  };
}

/** What a workspace's next invoice will charge, as Stripe prices it. */
export type UpcomingInvoiceRead = {
  status: "available" | "absent" | "unavailable";
  reason: string | null;
  currency: string | null;
  amountDueMinor: number | null;
  totalMinor: number | null;
  subtotalMinor: number | null;
  taxMinor: number | null;
  billingDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lineCount: number;
  computedAt: string;
};

/** Reads a workspace's upcoming invoice; a Stripe failure reads as unavailable. */
export async function readUpcomingInvoice(
  tenantId: string,
): Promise<UpcomingInvoiceRead> {
  const preview = await getUpcomingInvoicePreview(tenantId);
  if (preview.status !== "available")
    return {
      status: preview.status,
      reason: preview.reason,
      currency: null,
      amountDueMinor: null,
      totalMinor: null,
      subtotalMinor: null,
      taxMinor: null,
      billingDate: null,
      periodStart: null,
      periodEnd: null,
      lineCount: 0,
      computedAt: preview.computedAt,
    };
  return {
    status: "available",
    reason: null,
    currency: preview.currency,
    amountDueMinor: preview.amountDueMinorUnits,
    totalMinor: preview.totalMinorUnits,
    subtotalMinor: preview.subtotalMinorUnits,
    taxMinor: preview.taxMinorUnits,
    billingDate: preview.billingDate,
    periodStart: preview.periodStart,
    periodEnd: preview.periodEnd,
    lineCount: preview.lines.length,
    computedAt: preview.computedAt,
  };
}

/** Which directory rows a page lists. */
export interface WorkspaceDirectoryFilters {
  billingState?: BillingState;
  planId?: string;
  isComplimentary?: boolean;
  renewalKind?: WorkspaceRenewalKind;
  renewsBefore?: Date;
}

/** One workspace of a directory page. */
export type WorkspaceDirectoryItem = {
  tenantId: string;
  name: string | null;
  billingState: BillingState;
  planId: string | null;
  planName: string | null;
  isComplimentary: boolean;
  seats: number;
  mrrMinor: number;
  currency: string | null;
  renewalKind: WorkspaceRenewalKind | null;
  renewsAt: string | null;
};

/** A page of items, and the cursor of the next one. */
export type PageRead<T> = {
  items: T[];
  nextCursor: string | null;
};

function directorySelection(filters: WorkspaceDirectoryFilters) {
  const { table } = GetModel(TenantBillingStateModel);
  if (filters.billingState)
    return table.getAll(filters.billingState, "billingState");
  if (filters.planId) return table.getAll(filters.planId, "planId");
  return table;
}

function matchesDirectoryFilters(
  row: TenantBillingState,
  filters: WorkspaceDirectoryFilters,
): boolean {
  return (
    (filters.billingState === undefined ||
      row.billingState === filters.billingState) &&
    (filters.planId === undefined || row.planId === filters.planId) &&
    (filters.isComplimentary === undefined ||
      row.isComplimentary === filters.isComplimentary) &&
    (filters.renewalKind === undefined ||
      row.renewalKind === filters.renewalKind) &&
    (filters.renewsBefore === undefined ||
      (!!row.renewsAt && row.renewsAt < filters.renewsBefore))
  );
}

async function directoryRowsAfter(
  filters: WorkspaceDirectoryFilters,
  cursor: string | undefined,
): Promise<TenantBillingState[]> {
  const rows = await directorySelection(filters)
    .filter((row) =>
      row
        .key("deletedAt")
        .eq(null)
        .and(row.key("_id").eq(row.key("tenantId")))
        .and(row.key("_id").gt(cursor ?? "")),
    )
    .orderBy("_id", "asc")
    .run();
  return rows
    .map((row) => TenantBillingStateModel.fromDatabase(row))
    .filter((row): row is TenantBillingState => row !== undefined)
    .filter((row) => matchesDirectoryFilters(row, filters));
}

/**
 * Lists live directory rows a page at a time, ordered by workspace id; the
 * cursor is the last id of the previous page.
 */
export async function listWorkspaceDirectory(
  filters: WorkspaceDirectoryFilters,
  limit: number,
  cursor: string | undefined,
): Promise<PageRead<WorkspaceDirectoryItem>> {
  const rows = await directoryRowsAfter(filters, cursor);
  const page = rows.slice(0, limit);
  const tenants = await Promise.all(
    page.map((row) => GetModel(TenantModel).get(row._id)),
  );
  return {
    items: page.map((row, index) => ({
      tenantId: row._id,
      name: tenants[index]?.name ?? null,
      billingState: row.billingState,
      planId: row.planId,
      planName: row.planName,
      isComplimentary: row.isComplimentary,
      seats: row.seats,
      mrrMinor: row.mrrMinor,
      currency: row.currency,
      renewalKind: row.renewalKind,
      renewsAt: isoOrNull(row.renewsAt),
    })),
    nextCursor: rows.length > limit ? (page.at(-1)?._id ?? null) : null,
  };
}

/** One member of a segment, with the contact data campaign mail needs. */
export type SegmentUserItem = {
  userId: string;
  email: string;
  name: string | null;
  language: string | null;
};

/** A page of a segment's published membership. */
export type SegmentUsersRead = PageRead<SegmentUserItem> & {
  found: boolean;
  segmentName: string | null;
  evaluatedAt: string | null;
  total: number;
};

/**
 * Lists the users of a segment's published membership a page at a time,
 * ordered by user id; a deleted user is skipped but still counted in `total`.
 */
export async function listSegmentUsers(
  segmentId: string,
  limit: number,
  cursor: string | undefined,
): Promise<SegmentUsersRead> {
  const segment = await GetModel(SegmentModel).get(segmentId);
  if (!segment)
    return {
      found: false,
      segmentName: null,
      evaluatedAt: null,
      total: 0,
      items: [],
      nextCursor: null,
    };
  const memberships = await GetModel(UserSegmentModel).listBySegment(segmentId);
  const userIds = [...new Set(memberships.map((row) => row.userId))].sort();
  const after = userIds.filter((userId) => !cursor || userId > cursor);
  const pageIds = after.slice(0, limit);
  const users = await Promise.all(
    pageIds.map((userId) => GetModel(UserModel).get(userId)),
  );
  return {
    found: true,
    segmentName: segment.name,
    evaluatedAt: isoOrNull(segment.lastEvaluatedAt),
    total: memberships.length,
    items: users.flatMap((user) =>
      user
        ? [
            {
              userId: user._id,
              email: user.email,
              name: user.name || null,
              language: user.language || null,
            },
          ]
        : [],
    ),
    nextCursor: after.length > limit ? (pageIds.at(-1) ?? null) : null,
  };
}
