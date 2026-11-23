import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE, Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { TenantMemberModel, TenantModel } from "@antelopejs/interface-dms/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BillingDocumentStatus,
  type BillingDocumentType,
  type Invoice,
  InvoiceModel,
  TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import {
  ACTIVITY_KINDS,
  type ActivitySources,
  buildActivityFeed,
} from "../src/metrics/activity";
import { loadActivitySources } from "../src/metrics/activity-sources";
import { sumInReportingCurrency } from "../src/metrics/normalised-mrr";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import type { OperatorAction } from "../src/operator-actions/db/operator-action.table";
import { loadSuspensionImpact } from "../src/operator-actions/previews";
import type {
  OperatorActionStatus,
  WorkspaceOperatorAction,
} from "../src/operator-actions/types";
import { loadOpenInvoices } from "../src/routes/platformOwner/dashboard";
import { loadWorkspaceRecords } from "../src/utils/workspace-records";
import { getRowInstance } from "../src/utils/row-instance";
import { defined } from "./helpers/defined";
import { useMongoDatabase } from "./helpers/mongo";
import { subscriptionFixture } from "./helpers/subscription-fixture";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();

const NOW = new Date("2026-11-16T12:00:00Z");
const HOUR = 3_600_000;
const FEED_TENANT = "tenant-feed";
const OTHER_TENANT = "tenant-other";
const LIMITS = [1, 3, 5, 8, 50];
const TIED_TENANT = "tenant-tied";
const FEED_TENANTS = [FEED_TENANT, TIED_TENANT];

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR);
}

interface DocumentSeed {
  status: BillingDocumentStatus;
  issued: number;
  paid?: number;
  documentType?: BillingDocumentType;
  currency?: string;
  total?: number;
}

async function insertDocument(
  tenantId: string,
  seed: DocumentSeed,
): Promise<void> {
  await GetModel(InvoiceModel, tenantId)
    .table.insert({
      _id: randomUUID(),
      documentType: seed.documentType ?? "invoice",
      stripeInvoiceId: `in_${randomUUID()}`,
      stripeCreditNoteId: null,
      number: `INV-${seed.issued}`,
      status: seed.status,
      currency: seed.currency ?? "eur",
      amount: (seed.total ?? 1_000) - 1,
      total: seed.total ?? 1_000,
      issuedAt: hoursAgo(seed.issued),
      paidAt: seed.paid === undefined ? null : hoursAgo(seed.paid),
      createdAt: hoursAgo(seed.issued),
    })
    .run();
}

interface ActionSeed {
  action: WorkspaceOperatorAction;
  status: OperatorActionStatus;
  created: number;
  effective?: number;
  tenantId?: string;
  actorEmail?: string;
  details?: Record<string, string>;
}

async function insertAction(seed: ActionSeed): Promise<void> {
  await GetModel(OperatorActionModel)
    .table.insert({
      _id: randomUUID(),
      tenantId: seed.tenantId ?? FEED_TENANT,
      action: seed.action,
      status: seed.status,
      actorEmail: seed.actorEmail ?? "camille@ops.test",
      details: seed.details ?? {},
      createdAt: hoursAgo(seed.created),
      effectiveAt:
        seed.effective === undefined ? null : hoursAgo(seed.effective),
    })
    .run();
}

/** The workspace sources as read before the reads moved into the query. */
async function previousWorkspaceSources(
  tenantId: string,
): Promise<ActivitySources> {
  const [documents, actions, tenant] = await Promise.all([
    GetModel(InvoiceModel, tenantId)
      .table.filter((invoice) => invoice.key("documentType").eq("invoice"))
      .run(),
    GetModel(OperatorActionModel).table.getAll(tenantId, "tenantId").run(),
    GetModel(TenantModel).get(tenantId),
  ]);
  return {
    documents,
    actions,
    workspaces: tenant
      ? [{ _id: tenant._id, name: tenant.name, createdAt: tenant.createdAt }]
      : [],
    names: new Map(tenant ? [[tenant._id, tenant.name]] : []),
  };
}

/** The last suspension as read before the read moved into the query. */
async function previousLastSuspension(
  tenantId: string,
): Promise<OperatorAction | undefined> {
  const actions: OperatorAction[] = await GetModel(OperatorActionModel)
    .table.getAll(tenantId, "tenantId")
    .run();
  return actions
    .filter(
      (action) =>
        action.action === "workspace.suspend" && action.status === "succeeded",
    )
    .sort(
      (left, right) => +new Date(right.createdAt) - +new Date(left.createdAt),
    )[0];
}

/** The open invoices as read before the count and sum moved into the query. */
async function previousOpenInvoices(currency: string) {
  const open: Invoice[] = await GetModel(InvoiceModel, CROSS_INSTANCE)
    .table.getAll("open", "status")
    .run();
  return {
    count: open.length,
    awaiting: sumInReportingCurrency(
      open.map((invoice) => ({
        amountMinor: invoice.total,
        currency: invoice.currency,
      })),
      currency,
    ),
  };
}

/** The pending notifications as read before the kind moved into the query. */
async function previousCronNotifications(
  kind: "free_expired" | "suspended",
): Promise<TenantSubscription[]> {
  const rows = await GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
    .table.filter((row) => row.key("cronNotification").ne(null))
    .run();
  return rows
    .map((row) => TenantSubscriptionModel.fromDatabase(row))
    .filter(
      (row): row is TenantSubscription => row?.cronNotification?.kind === kind,
    );
}

beforeAll(async () => {
  for (const tenantId of [FEED_TENANT, OTHER_TENANT, TIED_TENANT]) {
    await defined(Schema.get(TENANT_SCHEMA_NAME))
      .createInstance(tenantId)
      .run();
    await insertTenant(tenantId);
  }
  const documents: DocumentSeed[] = [
    { status: "paid", issued: 900, paid: 2 },
    { status: "paid", issued: 40, paid: 30 },
    { status: "paid", issued: 60, paid: 59 },
    { status: "open", issued: 5 },
    { status: "open", issued: 70, currency: "usd", total: 2_500 },
    { status: "uncollectible", issued: 50 },
    { status: "draft", issued: 1 },
    { status: "void", issued: 3 },
    { status: "issued", issued: 4, documentType: "credit_note" },
    { status: "open", issued: 12 },
    { status: "paid", issued: 20, paid: 18 },
    { status: "paid", issued: 25, paid: 24 },
  ];
  for (const seed of documents) await insertDocument(FEED_TENANT, seed);
  await insertDocument(OTHER_TENANT, { status: "open", issued: 6, total: 700 });
  await insertDocument(OTHER_TENANT, {
    status: "open",
    issued: 7,
    currency: "GBP",
    total: 300,
  });
  const actions: ActionSeed[] = [
    { action: "workspace.suspend", status: "succeeded", created: 100 },
    {
      action: "workspace.suspend",
      status: "succeeded",
      created: 9,
      actorEmail: "latest@ops.test",
    },
    { action: "workspace.suspend", status: "failed", created: 1 },
    { action: "workspace.unsuspend", status: "succeeded", created: 15 },
    {
      action: "customer_balance.credit",
      status: "succeeded",
      created: 800,
      effective: 8,
    },
    { action: "subscription.upgrade", status: "succeeded", created: 22 },
    { action: "subscription.upgrade", status: "pending", created: 2 },
    {
      action: "invitation.send",
      status: "succeeded",
      created: 10,
      details: { emailDelivery: "failed" },
    },
    { action: "invitation.resend", status: "succeeded", created: 11 },
    {
      action: "workspace.complimentary_grant",
      status: "succeeded",
      created: 13,
    },
    { action: "workspace.support_join", status: "succeeded", created: 14 },
    { action: "invitation.revoke", status: "succeeded", created: 0.5 },
    {
      action: "workspace.suspend",
      status: "succeeded",
      created: 3,
      tenantId: OTHER_TENANT,
    },
  ];
  for (const seed of actions) await insertAction(seed);
  for (let index = 0; index < 8; index += 1) {
    await insertDocument(TIED_TENANT, {
      status: "paid",
      issued: 100 + index,
      paid: 10,
    });
  }
  await insertDocument(TIED_TENANT, { status: "open", issued: 10 });
  for (let index = 0; index < 4; index += 1) {
    await insertAction({
      action: "customer_balance.credit",
      status: "succeeded",
      created: 200 + index,
      effective: 10,
      tenantId: TIED_TENANT,
    });
  }
  await insertAction({
    action: "workspace.suspend",
    status: "succeeded",
    created: 10,
    tenantId: TIED_TENANT,
  });
});

describe("a workspace's activity feed read in the query", () => {
  for (const [tenantId, kind, limit] of FEED_TENANTS.flatMap((tenant) =>
    ACTIVITY_KINDS.flatMap((feedKind) =>
      LIMITS.map((cut) => [tenant, feedKind, cut] as const),
    ),
  )) {
    {
      it(`answers the ${kind} feed of ${tenantId} cut at ${limit} as the full read did`, async () => {
        const options = { kind, limit, now: NOW };
        const previous = buildActivityFeed(
          await previousWorkspaceSources(tenantId),
          options,
        );

        const current = buildActivityFeed(
          await loadActivitySources(tenantId, limit, kind),
          options,
        );

        expect(current).toEqual(previous);
        expect(current.length).toBeGreaterThan(0);
      });
    }
  }
});

describe("the suspension impact's last suspension read in the query", () => {
  it("names who suspended the workspace last, as the full read did", async () => {
    const { tenantId } = await subscriptionFixture({ status: "suspended" });
    await insertTenant(tenantId);
    await insertAction({
      action: "workspace.suspend",
      status: "succeeded",
      created: 30,
      tenantId,
      actorEmail: "first@ops.test",
    });
    await insertAction({
      action: "workspace.suspend",
      status: "succeeded",
      created: 6,
      tenantId,
      actorEmail: "last@ops.test",
    });
    await insertAction({
      action: "workspace.suspend",
      status: "failed",
      created: 1,
      tenantId,
      actorEmail: "failed@ops.test",
    });
    await insertAction({
      action: "workspace.unsuspend",
      status: "succeeded",
      created: 2,
      tenantId,
      actorEmail: "lifted@ops.test",
    });

    const impact = await loadSuspensionImpact(tenantId);

    const previous = await previousLastSuspension(tenantId);
    expect(previous?.actorEmail).toBe("last@ops.test");
    expect(impact.suspendedBy).toBe(previous?.actorEmail);
  });

  it("names nobody when no suspension succeeded, as the full read did", async () => {
    const { tenantId } = await subscriptionFixture({ status: "suspended" });
    await insertTenant(tenantId);
    await insertAction({
      action: "workspace.suspend",
      status: "failed",
      created: 1,
      tenantId,
    });

    const impact = await loadSuspensionImpact(tenantId);

    expect(await previousLastSuspension(tenantId)).toBeUndefined();
    expect(impact.suspendedBy).toBeNull();
  });
});

describe("the dashboard's open invoices counted in the query", () => {
  it("counts and sums the open invoices per currency as the full read did", async () => {
    const previous = await previousOpenInvoices("EUR");

    const current = await loadOpenInvoices("EUR");

    expect(previous.count).toBe(6);
    expect(current).toEqual(previous);
  });

  it("counts and sums 480 random open invoices, zero totals included, as the full read did", async () => {
    let seed = 3385;
    const next = (bound: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % bound;
    };
    const currencies = ["eur", "EUR", "usd", "gbp", "chf", "jpy"];
    const tenants = ["random-a", "random-b", "random-c", "random-d"];
    for (const tenantId of tenants) {
      await defined(Schema.get(TENANT_SCHEMA_NAME))
        .createInstance(tenantId)
        .run();
    }
    for (let index = 0; index < 480; index += 1) {
      const total =
        defined([0, 0, 100, -100, 250, 999][next(6)]) * (1 + next(3));
      await insertDocument(defined(tenants[next(tenants.length)]), {
        status: "open",
        issued: index,
        currency: currencies[next(currencies.length)],
        total,
      });
    }
    const previous = await previousOpenInvoices("EUR");

    const current = await loadOpenInvoices("EUR");

    expect(previous.count).toBeGreaterThan(480);
    expect(current).toEqual(previous);
  });
});

describe("the pending cron notifications filtered in the query", () => {
  it("keeps the notifications of the kind asked, as the full read did", async () => {
    await subscriptionFixture({
      cronNotification: { kind: "suspended", eventId: "s-1" },
    });
    await subscriptionFixture({
      cronNotification: { kind: "free_expired", eventId: "f-1" },
    });
    await subscriptionFixture({
      cronNotification: { kind: "free_expired", eventId: "f-2" },
    });
    await subscriptionFixture({ cronNotification: null });

    for (const kind of ["free_expired", "suspended"] as const) {
      const previous = await previousCronNotifications(kind);
      const current = await GetModel(
        TenantSubscriptionModel,
        CROSS_INSTANCE,
      ).findCronNotifications(kind);
      const ids = (rows: TenantSubscription[]) =>
        rows.map((row) => row._id).sort();
      expect(ids(current)).toEqual(ids(previous));
      expect(current.length).toBe(kind === "suspended" ? 1 : 2);
    }
  });
});

/** The records as read before the newest rows and counts moved into the query. */
async function previousWorkspaceRecords() {
  const [subscriptionRows, billingInfoRows, members] = await Promise.all([
    GetModel(TenantSubscriptionModel, CROSS_INSTANCE)
      .table.orderBy("updatedAt", "desc")
      .run(),
    GetModel(TenantBillingInfoModel, CROSS_INSTANCE)
      .table.orderBy("updatedAt", "desc")
      .run(),
    GetModel(TenantMemberModel, CROSS_INSTANCE)
      .table.group("_instance", (members, tenantId) => ({
        tenantId: tenantId.cast<string>(),
        userIds: members.pluck("userId"),
      }))
      .run(),
  ]);
  const firstByWorkspace = <Row extends { _id: string }, T>(
    rows: Row[],
    read: (row: Row) => T | undefined,
  ): Map<string, T> => {
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
  };
  const membersCounts = new Map<string, number>();
  for (const { tenantId, userIds } of members) {
    membersCounts.set(tenantId, userIds.length);
  }
  return {
    subscriptions: firstByWorkspace(subscriptionRows, (row) =>
      TenantSubscriptionModel.fromDatabase(row),
    ),
    billingInfos: firstByWorkspace(billingInfoRows, (row) =>
      TenantBillingInfoModel.fromDatabase(row),
    ),
    membersCounts,
  };
}

/** Two subscriptions share its newest date: neither read defines which one wins. */
const TIED_RECORDS = "records-c";

describe("the segment records' newest rows and member counts read in the query", () => {
  it("picks each workspace's newest subscription and billing details and counts its members as the full read did", async () => {
    const tenants = ["records-a", "records-b", TIED_RECORDS];
    for (const [index, tenantId] of tenants.entries()) {
      await defined(Schema.get(TENANT_SCHEMA_NAME))
        .createInstance(tenantId)
        .run();
      const subscriptionHours =
        tenantId === TIED_RECORDS ? [50, 7, 30, 7] : [50, 5 + index, 30];
      for (const hours of subscriptionHours) {
        await GetModel(TenantSubscriptionModel, tenantId)
          .table.insert({
            _id: randomUUID(),
            status: "active",
            planId: `plan-${hours}`,
            stripeSubscriptionId: null,
            cronNotification: null,
            updatedAt: hoursAgo(hours),
          })
          .run();
      }
      if (index !== 2) {
        for (const hours of [40 + index, 3]) {
          await GetModel(TenantBillingInfoModel, tenantId)
            .table.insert({
              _id: randomUUID(),
              companyName: `${tenantId} ${hours}`,
              updatedAt: hoursAgo(hours),
            })
            .run();
        }
      }
      for (let member = 0; member <= index * 2; member += 1) {
        await GetModel(TenantMemberModel, tenantId)
          .table.insert({
            _id: `${tenantId}-member-${member}`,
            userId: `${tenantId}-user-${member}`,
            isTenantOwner: member === 0,
            roleIds: [],
          })
          .run();
      }
    }
    const previous = await previousWorkspaceRecords();

    const current = await loadWorkspaceRecords();

    expect(previous.membersCounts.get("records-c")).toBe(5);
    expect(current.membersCounts).toEqual(previous.membersCounts);
    expect(previous.subscriptions.get("records-b")?.updatedAt).toEqual(
      hoursAgo(6),
    );
    const untied = (subscriptions: ReadonlyMap<string, TenantSubscription>) =>
      new Map(
        [...subscriptions].filter(([tenantId]) => tenantId !== TIED_RECORDS),
      );
    expect(untied(current.subscriptions)).toEqual(
      untied(previous.subscriptions),
    );
    expect(current.subscriptions.get(TIED_RECORDS)?.updatedAt).toEqual(
      hoursAgo(7),
    );
    expect(previous.billingInfos.size).toBe(2);
    expect(current.billingInfos).toEqual(previous.billingInfos);
  });
});
