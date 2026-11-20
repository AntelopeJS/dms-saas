import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { TenantExportArchive } from "@antelopejs/interface-dms/hooks";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BillingDocumentStatus,
  type BillingDocumentType,
  type Invoice,
  InvoiceModel,
  PlanModel,
} from "../src/db";
import { exportSaasTenantData } from "../src/hooks/tenant-export";
import { resolveTenantMemberRecipients } from "../src/notifications/recipients";
import { SaasWorkspaceDetailController } from "../src/routes/platformOwner/workspace-detail";
import { loadLastPayment } from "../src/routes/tenant/tenant-upcoming-invoice";
import { sumPaidInvoices } from "../src/users/user-detail";
import {
  loadAllTenantProjections,
  loadWorkspaceProjection,
} from "../src/utils/segment-matching";
import { isString } from "../src/utils/primitive-guards";
import { addTenantMember, createUser, useDmsAuth } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { isRecord } from "./helpers/records";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();
useDmsAuth();

const NOW = new Date("2026-11-16T12:00:00Z");
const HOUR = 3_600_000;
const BILLED = "tenant-billed";
const OTHER = "tenant-other";
const EMPTY = "tenant-empty";
const OPERATOR = fromPartial<User>({ _id: "operator" });

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
  amount?: number;
}

async function insertDocument(
  tenantId: string,
  seed: DocumentSeed,
): Promise<void> {
  const total = seed.total ?? 1_000;
  await GetModel(InvoiceModel, tenantId)
    .table.insert({
      _id: randomUUID(),
      documentType: seed.documentType ?? "invoice",
      stripeInvoiceId: `in_${randomUUID()}`,
      stripeCreditNoteId: null,
      number: `INV-${seed.issued}`,
      status: seed.status,
      currency: seed.currency ?? "eur",
      amount: seed.amount ?? total - 1,
      total,
      issuedAt: hoursAgo(seed.issued),
      paidAt: seed.paid === undefined ? null : hoursAgo(seed.paid),
      createdAt: hoursAgo(seed.issued),
    })
    .run();
}

/** Every invoice of a workspace, credit notes left out, as read before the reads moved into the query. */
async function previousInvoices(tenantId: string): Promise<Invoice[]> {
  const rows = await GetModel(InvoiceModel, tenantId)
    .table.filter((invoice) => invoice.key("documentType").eq("invoice"))
    .run();
  return rows
    .map((row) => InvoiceModel.fromDatabase(row))
    .filter((row): row is Invoice => row !== undefined);
}

/** The paid invoices summed per currency, as computed before. */
async function previousPaidTotals(tenantIds: string[]) {
  const invoices = (await Promise.all(tenantIds.map(previousInvoices))).flat();
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (invoice.status !== "paid") continue;
    const currency = (invoice.currency || "").toUpperCase();
    totals.set(currency, (totals.get(currency) ?? 0) + invoice.total);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

/** The revenue and last invoice date of a projection, as computed before. */
async function previousProjection(tenantId: string) {
  let totalRevenue = 0;
  let lastInvoiceAt: Date | null = null;
  for (const invoice of await previousInvoices(tenantId)) {
    if (invoice.status === "paid") totalRevenue += invoice.amount;
    const issuedAt = new Date(invoice.issuedAt);
    if (!lastInvoiceAt || issuedAt > lastInvoiceAt) lastInvoiceAt = issuedAt;
  }
  const daysSinceLastInvoice = lastInvoiceAt
    ? Math.floor((NOW.getTime() - lastInvoiceAt.getTime()) / (24 * HOUR))
    : null;
  return { totalRevenue, daysSinceLastInvoice };
}

interface WrittenEntry {
  path: string;
  content: string;
}

async function exportedInvoiceIds(tenantId: string): Promise<string[]> {
  const written: WrittenEntry[] = [];
  await exportSaasTenantData(
    tenantId,
    fromPartial<TenantExportArchive>({
      async addStream(path: string, stream: Readable): Promise<void> {
        written.push({
          path,
          content: (await buffer(stream)).toString("utf-8"),
        });
      },
    }),
    new AbortController().signal,
  );
  const entry = written.find(({ path }) => path === "invoices.jsonl");
  return (entry?.content.trimEnd().split("\n") ?? [])
    .filter((line) => line !== "")
    .map((line) => {
      const row: unknown = JSON.parse(line);
      if (!isRecord(row) || !isString(row._id)) {
        throw new Error("An exported line names no _id");
      }
      return row._id;
    })
    .sort();
}

function byCurrency<T extends { currency: string }>(totals: T[]): T[] {
  return [...totals].sort((a, b) => a.currency.localeCompare(b.currency));
}

beforeAll(async () => {
  await Promise.all([BILLED, OTHER, EMPTY].map(insertTenant));
  await Promise.all([
    insertDocument(BILLED, { status: "paid", issued: 90, paid: 89 }),
    insertDocument(BILLED, { status: "paid", issued: 60, paid: 20 }),
    insertDocument(BILLED, {
      status: "paid",
      issued: 50,
      paid: 49,
      currency: "usd",
      total: 2_500,
    }),
    insertDocument(BILLED, {
      status: "paid",
      issued: 40,
      paid: 39,
      total: 0,
      amount: 700,
    }),
    insertDocument(BILLED, { status: "paid", issued: 30 }),
    insertDocument(BILLED, { status: "open", issued: 10, total: 4_000 }),
    insertDocument(BILLED, { status: "void", issued: 5, total: 9_000 }),
    insertDocument(BILLED, {
      status: "paid",
      issued: 2,
      paid: 1,
      documentType: "credit_note",
      total: 50_000,
    }),
    insertDocument(OTHER, {
      status: "paid",
      issued: 70,
      paid: 69,
      currency: "EUR",
      total: 3_000,
    }),
    insertDocument(OTHER, { status: "open", issued: 3 }),
  ]);
});

describe("invoice reads moved into the query", () => {
  it("sums the paid invoices per currency as the whole read did", async () => {
    const tenants = [BILLED, OTHER, EMPTY];
    expect(byCurrency(await sumPaidInvoices(tenants))).toEqual(
      byCurrency(await previousPaidTotals(tenants)),
    );
  });

  it("projects the revenue and last invoice as the whole read did", async () => {
    const planModel = GetModel(PlanModel);
    const tenants = await GetModel(TenantModel).getAll();
    const together = await loadAllTenantProjections(planModel, NOW);
    for (const tenant of tenants) {
      const expected = await previousProjection(tenant._id);
      const alone = await loadWorkspaceProjection(tenant, planModel, NOW);
      expect(alone).toMatchObject(expected);
      expect(together.find(({ _id }) => _id === tenant._id)).toMatchObject(
        expected,
      );
    }
  });

  it("exports the invoices and no credit note", async () => {
    for (const tenantId of [BILLED, OTHER, EMPTY]) {
      const expected = (await previousInvoices(tenantId))
        .map(({ _id }) => _id)
        .sort();
      expect(await exportedInvoiceIds(tenantId)).toEqual(expected);
    }
  });

  it("counts the invoices on the workspace tabs", async () => {
    const controller = new SaasWorkspaceDetailController();
    for (const tenantId of [BILLED, OTHER, EMPTY]) {
      const counts = await controller.tabCounts(OPERATOR, tenantId);
      expect(counts.invoices).toBe((await previousInvoices(tenantId)).length);
    }
  });
});

describe("the lifetime revenue fact of a workspace", () => {
  it("sums the paid invoices of the first currency billed", async () => {
    const controller = new SaasWorkspaceDetailController();
    const lifetime = async (tenantId: string) =>
      (await controller.facts(OPERATOR, tenantId)).items.find(
        ({ id }) => id === "lifetime",
      );
    expect(await lifetime(BILLED)).toMatchInlineSnapshot(`
      {
        "detail": {
          "key": "saas.workspace_detail.facts.lifetime_detail",
          "params": {
            "count": {
              "type": "count",
              "value": 5,
            },
            "since": {
              "format": "medium",
              "type": "date",
              "value": "2026-11-12T18:00:00.000Z",
            },
          },
        },
        "eyebrow": "$saas.workspace_detail.facts.lifetime_revenue",
        "icon": "i-ph-chart-line-up",
        "id": "lifetime",
        "value": {
          "key": "saas.text.value",
          "params": {
            "value": {
              "currency": "EUR",
              "type": "money",
              "value": 3700,
            },
          },
        },
      }
    `);
    expect(await lifetime(OTHER)).toMatchInlineSnapshot(`
      {
        "detail": {
          "key": "saas.workspace_detail.facts.lifetime_detail",
          "params": {
            "count": {
              "type": "count",
              "value": 1,
            },
            "since": {
              "format": "medium",
              "type": "date",
              "value": "2026-11-13T14:00:00.000Z",
            },
          },
        },
        "eyebrow": "$saas.workspace_detail.facts.lifetime_revenue",
        "icon": "i-ph-chart-line-up",
        "id": "lifetime",
        "value": {
          "key": "saas.text.value",
          "params": {
            "value": {
              "currency": "EUR",
              "type": "money",
              "value": 3000,
            },
          },
        },
      }
    `);
    expect(await lifetime(EMPTY)).toMatchInlineSnapshot(`
      {
        "detail": "$saas.workspace_detail.facts.no_paid_invoice",
        "eyebrow": "$saas.workspace_detail.facts.lifetime_revenue",
        "icon": "i-ph-chart-line-up",
        "id": "lifetime",
        "value": "—",
      }
    `);
  });
});

describe("the last payment of a workspace", () => {
  it("is the invoice paid most recently", async () => {
    const lastPayment = async (tenantId: string) =>
      (await loadLastPayment(tenantId))?.number ?? null;
    expect(await lastPayment(BILLED)).toBe("INV-60");
    expect(await lastPayment(OTHER)).toBe("INV-70");
    expect(await lastPayment(EMPTY)).toBeNull();
  });
});

describe("the member recipients of a workspace notification", () => {
  it("are every member's user", async () => {
    const users = await Promise.all([createUser(), createUser()]);
    await Promise.all(
      users.map((user, index) => addTenantMember(OTHER, user, index === 0)),
    );
    expect((await resolveTenantMemberRecipients(OTHER)).sort()).toEqual(
      users.map(({ _id }) => _id).sort(),
    );
    expect(await resolveTenantMemberRecipients(EMPTY)).toEqual([]);
  });
});
