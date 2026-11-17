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

/** Each workspace's one row, as its model reads it, keyed by workspace. */
function byWorkspace<Row extends Table, T>(
  rows: (Row | null)[],
  read: (row: Row) => T | undefined,
): Map<string, T> {
  return new Map(
    rows.flatMap((row) => {
      if (row === null) return [];
      const value = read(row);
      return value === undefined ? [] : [[getRowInstance(row), value]];
    }),
  );
}

const INSTANCE_FIELD = "_instance";

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
  const [subscriptionRows, billingInfoRows, memberCounts, invoices] =
    await Promise.all([
      GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (rows) =>
          rows.orderBy("updatedAt", "desc").nth(0),
        )
        .run(),
      GetModel(TenantBillingInfoModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (rows) =>
          rows.orderBy("updatedAt", "desc").nth(0),
        )
        .run(),
      GetModel(TenantMemberModel, CROSS_INSTANCE)
        .table.group(INSTANCE_FIELD, (members, tenantId) => ({
          tenantId: tenantId.cast<string>(),
          count: members.count(),
        }))
        .run(),
      GetModel(InvoiceModel, CROSS_INSTANCE).getAllInvoices(),
    ]);
  const membersCounts = new Map(
    memberCounts.map(({ tenantId, count }) => [tenantId, count]),
  );
  return {
    subscriptions: byWorkspace(subscriptionRows, (row) =>
      TenantSubscriptionModel.fromDatabase(row),
    ),
    billingInfos: byWorkspace(billingInfoRows, (row) =>
      TenantBillingInfoModel.fromDatabase(row),
    ),
    membersCounts,
    invoices: groupByWorkspace(invoices),
  };
}
