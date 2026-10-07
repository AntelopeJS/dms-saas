import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MirrorRow {
  _id: string;
  [field: string]: unknown;
}

interface KeyedTable {
  rows: Map<string, MirrorRow>;
  lookupField: string;
}

const tables = vi.hoisted(() => ({
  InvoiceModel: {
    rows: new Map(),
    lookupField: "stripeInvoiceId",
  } as KeyedTable,
  RefundModel: {
    rows: new Map(),
    lookupField: "stripeRefundId",
  } as KeyedTable,
}));

/** Lets every concurrent writer finish its lookup before any of them inserts. */
function yieldToOtherWriters(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function keyedModel(table: KeyedTable) {
  const findByLookup = async (value: string) => {
    await yieldToOtherWriters();
    return [...table.rows.values()].find(
      (row) => row[table.lookupField] === value,
    );
  };
  return {
    get: async (id: string) => table.rows.get(id),
    insert: async (row: MirrorRow) => {
      if (table.rows.has(row._id)) throw new Error("E11000 duplicate key");
      table.rows.set(row._id, { ...row });
      return [row._id];
    },
    update: async (id: string, patch: Partial<MirrorRow>) => {
      const row = table.rows.get(id);
      if (row) Object.assign(row, patch);
      return row ? 1 : 0;
    },
    findOneByStripeInvoice: findByLookup,
    findOneByStripeRefund: findByLookup,
  };
}

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }) => {
      if (model.name === "TenantSubscriptionModel")
        return {
          findOneByStripeCustomer: async () => ({ _instance: "tenant-a" }),
        };
      const table = tables[model.name as keyof typeof tables];
      if (!table) throw new Error(`no fake registered for ${model.name}`);
      return keyedModel(table);
    },
  };
});

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    charges: { retrieve: async () => ({ customer: "cus_1" }) },
  }),
}));

const { upsertInvoice } = await import("../src/stripe/webhook-shared");
const { handleChargeRefundUpdated } =
  await import("../src/stripe/webhook-handlers");

function stripeInvoice(status: Stripe.Invoice.Status): Stripe.Invoice {
  return {
    id: "in_1",
    customer: "cus_1",
    number: "INV-0001",
    amount_due: 5935,
    subtotal: 5935,
    total_taxes: [],
    total: 5935,
    currency: "eur",
    status,
    status_transitions: { paid_at: null },
    metadata: {},
    created: 1_790_000_000,
    period_start: 1_790_000_000,
    period_end: 1_792_592_000,
    lines: { has_more: false, data: [] },
  } as unknown as Stripe.Invoice;
}

function refundEvent(status: Stripe.Refund["status"]): Stripe.Event {
  return {
    id: `evt_refund_${status}`,
    type: "charge.refund.updated",
    data: {
      object: {
        id: "re_1",
        charge: "ch_1",
        amount: 1200,
        currency: "eur",
        status,
        failure_reason: null,
      },
    },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  tables.InvoiceModel.rows.clear();
  tables.RefundModel.rows.clear();
});

describe("Stripe invoice collection state", () => {
  it("mirrors what Stripe is doing to collect the invoice", async () => {
    const retryAt = 1_790_300_000;
    await upsertInvoice(
      {
        ...stripeInvoice("open"),
        amount_paid: 1_000,
        attempt_count: 2,
        next_payment_attempt: retryAt,
        due_date: null,
        automatically_finalizes_at: null,
        latest_revision: { id: "in_2" },
      } as unknown as Stripe.Invoice,
      "tenant-a",
    );

    expect(tables.InvoiceModel.rows.get("in_1")).toMatchObject({
      amountPaid: 1_000,
      attemptCount: 2,
      nextPaymentAttemptAt: new Date(retryAt * 1_000),
      dueAt: null,
      autoFinalizesAt: null,
      latestRevisionStripeId: "in_2",
    });
  });
});

describe("Stripe invoice mirror keys", () => {
  it("keeps concurrent events of one invoice to a single row", async () => {
    await Promise.all([
      upsertInvoice(stripeInvoice("open"), "tenant-a"),
      upsertInvoice(stripeInvoice("paid"), "tenant-a"),
    ]);

    expect([...tables.InvoiceModel.rows.keys()]).toEqual(["in_1"]);
    expect(tables.InvoiceModel.rows.get("in_1")?.stripeInvoiceId).toBe("in_1");
  });

  it("updates a legacy row found by its Stripe id instead of adding one", async () => {
    tables.InvoiceModel.rows.set("legacy-random-id", {
      _id: "legacy-random-id",
      stripeInvoiceId: "in_1",
      stripeCreditNoteId: null,
      status: "open",
    });

    await upsertInvoice(stripeInvoice("paid"), "tenant-a");

    expect([...tables.InvoiceModel.rows.keys()]).toEqual(["legacy-random-id"]);
    expect(tables.InvoiceModel.rows.get("legacy-random-id")?.status).toBe(
      "paid",
    );
  });
});

describe("Stripe refund mirror keys", () => {
  it("keeps concurrent events of one refund to a single row", async () => {
    await Promise.all([
      handleChargeRefundUpdated(refundEvent("pending")),
      handleChargeRefundUpdated(refundEvent("failed")),
    ]);

    expect([...tables.RefundModel.rows.keys()]).toEqual(["re_1"]);
    expect(tables.RefundModel.rows.get("re_1")?.stripeRefundId).toBe("re_1");
  });
});
