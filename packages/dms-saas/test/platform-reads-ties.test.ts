import { randomUUID } from "node:crypto";
import { Schema } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import { describe, expect, it } from "vitest";
import { InvoiceModel } from "../src/db";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { loadSuspensionImpact } from "../src/operator-actions/previews";
import { loadOpenInvoices } from "../src/routes/platformOwner/dashboard";
import { useMongoDatabase } from "./helpers/mongo";
import { subscriptionFixture } from "./helpers/subscription-fixture";
import { insertTenant } from "./helpers/workspaces";

useMongoDatabase();

const ISSUED_AT = new Date("2026-11-01T09:00:00Z");
const SUSPENDED_AT = new Date("2026-11-10T09:00:00Z");
const READS = 5;

async function insertOpenInvoice(
  tenantId: string,
  currency: string,
  total: number,
): Promise<void> {
  await GetModel(InvoiceModel, tenantId)
    .table.insert({
      _id: randomUUID(),
      documentType: "invoice",
      stripeInvoiceId: `in_${randomUUID()}`,
      stripeCreditNoteId: null,
      number: null,
      status: "open",
      currency,
      amount: total,
      total,
      issuedAt: ISSUED_AT,
      paidAt: null,
      createdAt: ISSUED_AT,
    })
    .run();
}

async function insertSuspension(
  tenantId: string,
  id: string,
  actorEmail: string,
): Promise<void> {
  await GetModel(OperatorActionModel)
    .table.insert({
      _id: id,
      tenantId,
      action: "workspace.suspend",
      status: "succeeded",
      actorEmail,
      details: {},
      createdAt: SUSPENDED_AT,
      effectiveAt: null,
    })
    .run();
}

describe("the dashboard's open invoices", () => {
  it("lists a currency whose open invoices sum to zero", async () => {
    const tenantId = "tenant-open";
    await Schema.get(TENANT_SCHEMA_NAME)!.createInstance(tenantId).run();
    await insertOpenInvoice(tenantId, "usd", 500);
    await insertOpenInvoice(tenantId, "usd", -500);
    await insertOpenInvoice(tenantId, "eur", 100);
    await insertOpenInvoice(tenantId, "chf", 300);
    await insertOpenInvoice(tenantId, "chf", 200);

    const open = await loadOpenInvoices("EUR");

    expect(open).toEqual({
      count: 5,
      awaiting: {
        amountMinor: 100,
        currency: "EUR",
        otherCurrencies: [
          { currency: "CHF", amountMinor: 500 },
          { currency: "USD", amountMinor: 0 },
        ],
      },
    });
  });
});

describe("the suspension impact's last suspension", () => {
  it("names the same operator on every read when two suspensions share a date", async () => {
    const { tenantId } = await subscriptionFixture({ status: "suspended" });
    await insertTenant(tenantId);
    await insertSuspension(tenantId, "op-b", "second-id@ops.test");
    await insertSuspension(tenantId, "op-a", "first-id@ops.test");
    await insertSuspension(tenantId, "op-c", "third-id@ops.test");

    const names = [];
    for (let read = 0; read < READS; read += 1) {
      names.push((await loadSuspensionImpact(tenantId)).suspendedBy);
    }

    expect(names).toEqual(Array(READS).fill("first-id@ops.test"));
  });
});
