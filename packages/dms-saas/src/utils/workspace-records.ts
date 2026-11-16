import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import {
  GetModel,
  type Table,
} from "@antelopejs/interface-database-decorators";
import { TenantMemberModel } from "@antelopejs/interface-dms/db";
import {
  type Invoice,
  InvoiceModel,
  type TenantBillingInfo,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../db";
import { getRowInstance } from "./row-instance";

/** The per-workspace records a segment projection reads, keyed by workspace. */
export interface WorkspaceRecords {
  subscriptions: ReadonlyMap<string, TenantSubscription>;
  billingInfos: ReadonlyMap<string, TenantBillingInfo>;
  membersCounts: ReadonlyMap<string, number>;
  invoices: ReadonlyMap<string, Invoice[]>;
}

/**
 * The first row of each workspace, in the order given, as its model reads it:
 * what `findOne` answers for that workspace.
 */
function firstByWorkspace<Row extends Table, T>(
  rows: Row[],
  read: (row: Row) => T | undefined,
): Map<string, T> {
  const seen = new Set<string>();
  const first = new Map<string, T>();
  for (const row of rows) {
    const tenantId = getRowInstance(row);
    if (seen.has(tenantId)) continue;
    seen.add(tenantId);
    const value = read(row);
    if (value !== undefined) first.set(tenantId, value);
  }
  return first;
}

function groupByWorkspace<T extends Table>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const tenantId = getRowInstance(row);
    const group = groups.get(tenantId) ?? [];
    group.push(row);
    groups.set(tenantId, group);
  }
  return groups;
}

/**
 * Every workspace's records in one read per table rather than one per
 * workspace: the subscription and billing details last updated, as
 * `findOne` picks them, the member count and the invoices.
 */
export async function loadWorkspaceRecords(): Promise<WorkspaceRecords> {
  const [subscriptionRows, billingInfoRows, members, invoices] =
    await Promise.all([
      GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
        .table.orderBy("updatedAt", "desc")
        .run(),
      GetModel(TenantBillingInfoModel, CROSS_INSTANCE)
        .table.orderBy("updatedAt", "desc")
        .run(),
      GetModel(TenantMemberModel, CROSS_INSTANCE).listAll(),
      GetModel(InvoiceModel, CROSS_INSTANCE).getAllInvoices(),
    ]);
  const membersCounts = new Map(
    [...groupByWorkspace(members)].map(([tenantId, rows]) => [
      tenantId,
      rows.length,
    ]),
  );
  return {
    subscriptions: firstByWorkspace(subscriptionRows, (row) =>
      TenantSubscriptionModel.fromDatabase(row),
    ),
    billingInfos: firstByWorkspace(billingInfoRows, (row) =>
      TenantBillingInfoModel.fromDatabase(row),
    ),
    membersCounts,
    invoices: groupByWorkspace(invoices),
  };
}
