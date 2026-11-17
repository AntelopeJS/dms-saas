import { CROSS_INSTANCE, ValueProxy } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { type Invoice, InvoiceModel } from "../db";
import { OperatorActionModel } from "../operator-actions/db/operator-action.model";
import type { OperatorAction } from "../operator-actions/db/operator-action.table";
import { getRowInstance } from "../utils/row-instance";
import {
  type ActivityFeedScope,
  type ActivityKind,
  type ActivitySources,
  type ActivityWorkspace,
  activityFeedScope,
} from "./activity";

/**
 * Each source is read newest first and cut before merging: a few times the
 * feed's length, so a feed of one kind is still full after the others drop.
 */
const SOURCE_OVERFETCH = 4;
const SUCCEEDED_STATUS = "succeeded";
const INVOICE_DOCUMENT_TYPE = "invoice";
/** The date a feed entry is ordered on, computed in the query. */
const FEED_AT = "feedAt";

/** The names of the workspaces a feed mentions. */
async function workspaceNames(
  tenantIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return new Map();
  const tenants = await GetModel(TenantModel).getMany(unique);
  return new Map(tenants.map((tenant) => [tenant._id, tenant.name]));
}

async function platformSources(limit: number): Promise<ActivitySources> {
  const depth = limit * SOURCE_OVERFETCH;
  const [documents, actions, workspaces] = await Promise.all([
    GetModel(InvoiceModel, CROSS_INSTANCE)
      .table.orderBy("issuedAt", "desc")
      .slice(0, depth)
      .run(),
    GetModel(OperatorActionModel)
      .table.orderBy("createdAt", "desc")
      .filter((row) => row.key("status").eq(SUCCEEDED_STATUS))
      .slice(0, depth)
      .run(),
    GetModel(TenantModel)
      .table.orderBy("createdAt", "desc")
      .slice(0, depth)
      .pluck("_id", "name", "createdAt")
      .run(),
  ]);
  const names = await workspaceNames([
    ...documents.map((document) => getRowInstance(document)),
    ...actions.map((action) => action.tenantId),
  ]);
  return { documents, actions, workspaces, names };
}

/**
 * A workspace's invoices the feed shows, in stored order, from the date of
 * the newest `limit` of them on: the feed's own sort then cuts them as it cut
 * every invoice, ties included.
 */
async function workspaceDocuments(
  tenantId: string,
  scope: ActivityFeedScope,
  limit: number,
): Promise<Invoice[]> {
  if (scope.documentStatuses.length === 0) return [];
  const shown = () =>
    GetModel(InvoiceModel, tenantId).table.filter((row) =>
      row
        .key("documentType")
        .eq(INVOICE_DOCUMENT_TYPE)
        .and(
          ValueProxy.constant(scope.documentStatuses).includes(
            row.key("status"),
          ),
        ),
    );
  const boundary = await shown()
    .map((row) => ({
      [FEED_AT]: row.key("paidAt").default(row.key("issuedAt")),
    }))
    .orderBy(FEED_AT, "desc")
    .nth(limit - 1)
    .default(null)
    .run();
  const rows = await (
    boundary
      ? shown().filter((row) =>
          row.key("paidAt").default(row.key("issuedAt")).ge(boundary[FEED_AT]),
        )
      : shown()
  ).run();
  return rows
    .map((row) => InvoiceModel.fromDatabase(row))
    .filter((row): row is Invoice => row !== undefined);
}

/**
 * A workspace's operator actions the feed shows, in stored order, from the
 * date of the newest `limit` of them on: the feed's own sort then cuts them as
 * it cut every action, ties included.
 */
async function workspaceActions(
  tenantId: string,
  scope: ActivityFeedScope,
  limit: number,
): Promise<OperatorAction[]> {
  if (scope.actions.length === 0) return [];
  const shown = () =>
    GetModel(OperatorActionModel)
      .table.getAll(tenantId, "tenantId")
      .filter((row) =>
        row
          .key("status")
          .eq(SUCCEEDED_STATUS)
          .and(ValueProxy.constant(scope.actions).includes(row.key("action"))),
      );
  const boundary = await shown()
    .map((row) => ({
      [FEED_AT]: row.key("effectiveAt").default(row.key("createdAt")),
    }))
    .orderBy(FEED_AT, "desc")
    .nth(limit - 1)
    .default(null)
    .run();
  return (
    boundary
      ? shown().filter((row) =>
          row
            .key("effectiveAt")
            .default(row.key("createdAt"))
            .ge(boundary[FEED_AT]),
        )
      : shown()
  ).run();
}

async function workspaceSources(
  tenantId: string,
  limit: number,
  kind: ActivityKind,
): Promise<ActivitySources> {
  const scope = activityFeedScope(kind);
  const [documents, actions, tenant] = await Promise.all([
    workspaceDocuments(tenantId, scope, limit),
    workspaceActions(tenantId, scope, limit),
    GetModel(TenantModel).get(tenantId),
  ]);
  const workspaces: ActivityWorkspace[] = tenant
    ? [{ _id: tenant._id, name: tenant.name, createdAt: tenant.createdAt }]
    : [];
  const names = new Map(tenant ? [[tenant._id, tenant.name]] : []);
  return { documents, actions, workspaces, names };
}

/**
 * What a feed is built from: one workspace's records, or the platform's.
 *
 * @param kind The feed a workspace's records are read for; the platform's
 * are read for every kind
 */
export async function loadActivitySources(
  tenantId: string | null,
  limit: number,
  kind: ActivityKind = "all",
): Promise<ActivitySources> {
  return tenantId
    ? workspaceSources(tenantId, limit, kind)
    : platformSources(limit);
}
