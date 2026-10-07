import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { type Invoice, InvoiceModel } from "../db";
import { OperatorActionModel } from "../operator-actions/db/operator-action.model";
import type { OperatorAction } from "../operator-actions/db/operator-action.table";
import { getRowInstance } from "../utils/row-instance";
import type { ActivitySources, ActivityWorkspace } from "./activity";

// Each source is read newest first and cut before merging: a few times the
// feed's length, so a feed of one kind is still full after the others drop.
const SOURCE_OVERFETCH = 4;
const SUCCEEDED_STATUS = "succeeded";

/** The names of the workspaces a feed mentions. */
async function workspaceNames(
  tenantIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return new Map();
  const tenants = await GetModel(TenantModel).getMany(unique);
  return new Map(tenants.map((tenant) => [tenant._id, tenant.name]));
}

function newestFirst<T>(
  rows: T[],
  dateOf: (row: T) => Date,
  limit: number,
): T[] {
  return rows
    .slice()
    .sort((left, right) => dateOf(right).getTime() - dateOf(left).getTime())
    .slice(0, limit);
}

async function platformSources(limit: number): Promise<ActivitySources> {
  const depth = limit * SOURCE_OVERFETCH;
  const [documents, actions, tenants] = await Promise.all([
    GetModel(InvoiceModel, CROSS_INSTANCE)
      .table.orderBy("issuedAt", "desc")
      .slice(0, depth)
      .run() as Promise<Invoice[]>,
    GetModel(OperatorActionModel)
      .table.orderBy("createdAt", "desc")
      .filter((row) => row.key("status").eq(SUCCEEDED_STATUS))
      .slice(0, depth)
      .run() as Promise<OperatorAction[]>,
    GetModel(TenantModel).table.pluck("_id", "name", "createdAt").run(),
  ]);
  const workspaces = newestFirst(
    tenants as ActivityWorkspace[],
    (tenant) => new Date(tenant.createdAt),
    depth,
  );
  const names = await workspaceNames([
    ...documents.map((document) => getRowInstance(document)),
    ...actions.map((action) => action.tenantId),
  ]);
  return { documents, actions, workspaces, names };
}

async function workspaceSources(tenantId: string): Promise<ActivitySources> {
  const [documents, actions, tenant] = await Promise.all([
    GetModel(InvoiceModel, tenantId).getAllInvoices(),
    GetModel(OperatorActionModel)
      .table.getAll(tenantId, "tenantId")
      .run() as Promise<OperatorAction[]>,
    GetModel(TenantModel).get(tenantId),
  ]);
  const workspaces: ActivityWorkspace[] = tenant
    ? [{ _id: tenant._id, name: tenant.name, createdAt: tenant.createdAt }]
    : [];
  const names = new Map(tenant ? [[tenant._id, tenant.name]] : []);
  return { documents, actions, workspaces, names };
}

/** What a feed is built from: one workspace's records, or the platform's. */
export async function loadActivitySources(
  tenantId: string | null,
  limit: number,
): Promise<ActivitySources> {
  return tenantId ? workspaceSources(tenantId) : platformSources(limit);
}
