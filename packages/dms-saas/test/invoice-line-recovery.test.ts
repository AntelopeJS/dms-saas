import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db/models/stripeWebhookEvents.model";
import { TenantSubscriptionModel } from "../src/db";
import {
  InvoiceLineInjectionModel,
  processInvoiceLineInjection,
  reconcileInvoiceLineInjections,
  INVOICE_LINE_LEASE_MS,
} from "../src/invoice-line-items/recovery";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";

/** Stripe, simulated: only what the recovery calls. Not a statement about real Stripe. */
const harness = vi.hoisted(() => {
  interface FakeInvoice {
    id: string;
    object: "invoice";
    customer: string;
    currency: string;
    status: string;
    auto_advance: boolean;
    billing_reason: string;
    created: number;
    period_start: number;
    period_end: number;
    parent: { subscription_details: { subscription: string } };
    total: number;
    subtotal: number;
    amount_due: number;
    metadata: Record<string, string>;
    status_transitions: Record<string, number>;
    lines: { data: unknown[] };
  }
  interface FakeItem {
    id: string;
    invoice: string;
    amount: number;
    currency: string;
    period: { start: number; end: number };
    metadata: Record<string, string>;
  }
  const state = {
    invoices: new Map<string, FakeInvoice>(),
    items: [] as FakeItem[],
    idempotency: new Map<string, unknown>(),
    faults: new Map<string, number>(),
    latencyMs: 0,
    calls: { update: 0, finalizeEffects: 0, itemCreates: 0, pay: 0 },
    resolve: (() => []) as (ctx: unknown) => unknown,
    since: null as Date | null,
    providers: ["cloud"] as string[],
    otherResolve: (() => []) as (ctx: unknown) => unknown,
    required: [] as string[],
    /** Stripe misbehaving on create: duplicate the item, or store another currency. */
    createQuirk: null as null | "duplicate" | "currency",
  };
  const pause = () => new Promise((r) => setTimeout(r, state.latencyMs));
  const fault = (point: string) => {
    const remaining = state.faults.get(point) ?? 0;
    if (remaining === 0) return;
    state.faults.set(point, remaining - 1);
    throw new Error(`simulated Stripe failure at ${point}`);
  };
  const clone = <T>(value: T): T => structuredClone(value);
  function list<T>(rows: T[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const row of rows) yield clone(row);
      },
    };
  }
  const client = {
    invoices: {
      retrieve: async (id: string) => {
        await pause();
        fault("retrieve");
        return clone(state.invoices.get(id));
      },
      update: async (id: string, params: { auto_advance: boolean }) => {
        await pause();
        fault("update:before");
        const invoice = state.invoices.get(id);
        if (!invoice || invoice.status !== "draft")
          throw new Error("invoice_not_editable");
        state.calls.update += 1;
        invoice.auto_advance = params.auto_advance;
        fault("update:after");
        return clone(invoice);
      },
      finalizeInvoice: async (
        id: string,
        params: { auto_advance: boolean },
        options: { idempotencyKey: string },
      ) => {
        await pause();
        fault("finalize:before");
        if (state.idempotency.has(options.idempotencyKey))
          return clone(state.idempotency.get(options.idempotencyKey));
        const invoice = state.invoices.get(id);
        if (!invoice || invoice.status !== "draft")
          throw new Error("invoice_already_finalized");
        invoice.status = "open";
        invoice.auto_advance = params.auto_advance;
        state.calls.finalizeEffects += 1;
        state.idempotency.set(options.idempotencyKey, clone(invoice));
        fault("finalize:after");
        return clone(invoice);
      },
      pay: async () => {
        state.calls.pay += 1;
      },
      list: (params: {
        subscription: string;
        status: string;
        created: { gte: number };
      }) =>
        list(
          [...state.invoices.values()].filter(
            (invoice) =>
              invoice.parent.subscription_details.subscription ===
                params.subscription &&
              invoice.status === params.status &&
              invoice.created >= params.created.gte,
          ),
        ),
    },
    invoiceItems: {
      list: (params: { invoice: string }) =>
        list(state.items.filter((item) => item.invoice === params.invoice)),
      create: async (
        params: {
          invoice: string;
          amount: number;
          currency: string;
          period: { start: number; end: number };
          metadata: Record<string, string>;
        },
        options: { idempotencyKey: string },
      ) => {
        await pause();
        fault(`item:${params.metadata.saasLineKey}`);
        if (state.idempotency.has(options.idempotencyKey))
          return state.idempotency.get(options.idempotencyKey);
        const invoice = state.invoices.get(params.invoice);
        if (!invoice || invoice.status !== "draft")
          throw new Error("invoice_not_editable");
        const item = {
          id: `ii_${state.items.length}`,
          invoice: params.invoice,
          amount: params.amount,
          currency: state.createQuirk === "currency" ? "usd" : params.currency,
          period: params.period,
          metadata: params.metadata,
        };
        state.items.push(item);
        if (state.createQuirk === "duplicate")
          state.items.push({ ...item, id: `${item.id}_dup` });
        state.calls.itemCreates += 1;
        state.idempotency.set(options.idempotencyKey, item);
        return item;
      },
    },
  };
  return { state, client };
});

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => harness.client,
  getStripeReadClient: () => harness.client,
  isStripeConfigured: () => true,
}));
vi.mock("../src/implementations/dms-saas/invoice-line-items", () => ({
  getInvoiceLineItemsProviders: () =>
    harness.state.providers.map((id) => ({
      id,
      resolve: (ctx: unknown) =>
        id === "cloud"
          ? harness.state.resolve(ctx)
          : harness.state.otherResolve(ctx),
    })),
}));
vi.mock("../src/config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getInvoiceDiscoverySince: () => harness.state.since,
  getRequiredInvoiceLineProviders: () => harness.state.required,
}));

const PERIOD_START = 1_792_266_817; // 2026-10-18T19:53:37Z
const PERIOD_END = 1_794_945_217; // 2026-11-18T19:53:37Z
const LINES = [
  {
    key: "usage-cpu-minutes",
    description: "vCPU allocation",
    amountCents: 16,
    quantity: 606,
  },
  {
    key: "included-credit",
    description: "Included usage credit",
    amountCents: -10,
    quantity: 1,
  },
];
const SETUP_TIMEOUT_MS = 90_000;
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "invoice-line-recovery" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

beforeEach(() => {
  const { state } = harness;
  state.invoices.clear();
  state.items = [];
  state.idempotency.clear();
  state.faults.clear();
  state.latencyMs = 0;
  state.calls = { update: 0, finalizeEffects: 0, itemCreates: 0, pay: 0 };
  state.resolve = () => LINES;
  state.since = null;
  state.providers = ["cloud"];
  state.otherResolve = () => [];
  state.required = [];
  state.createQuirk = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Fixture {
  tenantId: string;
  customerId: string;
  subscriptionId: string;
  invoiceId: string;
}

async function aCycleInvoice(
  overrides: Record<string, unknown> = {},
): Promise<Fixture> {
  const tenantId = `t-${randomUUID()}`;
  const customerId = `cus_${randomUUID().slice(0, 8)}`;
  const subscriptionId = `sub_${randomUUID().slice(0, 8)}`;
  const invoiceId = `in_${randomUUID().slice(0, 8)}`;
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: null,
    status: "active",
    isComplimentary: false,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    paidUsagePeriods: [
      {
        stripeSubscriptionId: subscriptionId,
        start: new Date(PERIOD_START * 1000),
        end: null,
      },
    ],
  } as never);
  harness.state.invoices.set(invoiceId, {
    id: invoiceId,
    object: "invoice",
    customer: customerId,
    currency: "eur",
    status: "draft",
    auto_advance: true,
    billing_reason: "subscription_cycle",
    created: PERIOD_END,
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    parent: { subscription_details: { subscription: subscriptionId } },
    total: 500,
    subtotal: 500,
    amount_due: 500,
    metadata: {},
    status_transitions: {},
    lines: { data: [] },
    ...overrides,
  });
  return { tenantId, customerId, subscriptionId, invoiceId };
}

function invoiceCreated(
  fixture: Fixture,
  eventId = `evt_${randomUUID()}`,
): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    type: "invoice.created",
    data: {
      object: structuredClone(harness.state.invoices.get(fixture.invoiceId)),
    },
  } as unknown as Stripe.Event;
}

const tasks = () => GetModel(InvoiceLineInjectionModel);
const task = (id: string) => tasks().get(id);
const receipt = (id: string) => GetModel(StripeWebhookEventModel).get(id);
const managedKeys = (invoiceId: string) =>
  harness.state.items
    .filter((i) => i.invoice === invoiceId)
    .map((i) => `${i.metadata.saasLineKey}=${i.amount}`)
    .sort();
const invoice = (id: string) => harness.state.invoices.get(id);

async function runRecovery(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1)
    await reconcileInvoiceLineInjections(
      new Date(Date.now() + 24 * 3_600_000 * (i + 1)),
    );
}

describe("invoice line recovery — chain with the MongoDB provider and a simulated Stripe", () => {
  it("acknowledges after confirmed suspension, waits while coverage is missing, then injects and finalizes once", async () => {
    const f = await aCycleInvoice();
    harness.state.resolve = () => {
      throw new Error(
        "Usage of workspace is not fully accounted for from 2026-11-18T18:00:00.000Z",
      );
    };
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect((await receipt(event.id))?.result).toBe("success");
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    expect(invoice(f.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: false,
    });
    expect(managedKeys(f.invoiceId)).toEqual([]);

    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    expect((await task(f.invoiceId))?.lastError).toContain("provider_failed");

    harness.state.resolve = () => LINES;
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
    expect(invoice(f.invoiceId)).toMatchObject({
      status: "open",
      auto_advance: true,
    });
    expect(harness.state.calls).toMatchObject({
      finalizeEffects: 1,
      itemCreates: 2,
      pay: 0,
    });

    await dispatchStripeWebhookEvent(event);
    await runRecovery();
    expect(harness.state.calls).toMatchObject({
      finalizeEffects: 1,
      itemCreates: 2,
    });
  });

  it("refuses to acknowledge an unconfirmed suspension, and the task — not a redelivery — completes it and closes the receipt", async () => {
    const f = await aCycleInvoice();
    harness.state.faults.set("update:before", 1);
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow(
      "suspension not confirmed",
    );
    expect((await receipt(event.id))?.result).toBe("reconciliation_required");
    expect((await task(f.invoiceId))?.state).toBe("registered");
    expect(invoice(f.invoiceId)?.auto_advance).toBe(true);

    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect((await receipt(event.id))?.result).toBe("success");
    await expect(dispatchStripeWebhookEvent(event)).resolves.toBeUndefined();
  });

  it("confirms a suspension whose response was lost by reading Stripe back", async () => {
    const f = await aCycleInvoice();
    harness.state.faults.set("update:after", 1);
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect((await task(f.invoiceId))?.state).not.toBe("registered");
    expect(harness.state.calls.update).toBe(1);
  });

  it("hands a draft Stripe finalized before suspension to an operator, without closing the receipt", async () => {
    const f = await aCycleInvoice();
    harness.state.faults.set("update:before", 1);
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow();
    invoice(f.invoiceId)!.status = "open";
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "needs_operator",
      reason: "before_suspension:finalized:open/auto_advance=true",
      suspendedAt: null,
    });
    expect((await receipt(event.id))?.result).toBe("reconciliation_required");
    expect(harness.state.calls.finalizeEffects).toBe(0);
  });

  it.each([
    [
      "already finalized",
      (f: Fixture) => {
        invoice(f.invoiceId)!.status = "open";
      },
      "before_suspension:finalized:open/auto_advance=true",
    ],
    [
      "another customer",
      (f: Fixture) => {
        invoice(f.invoiceId)!.customer = "cus_other";
      },
      "before_suspension:identity_customer",
    ],
  ])(
    "answers 500 when the draft is unexpected before suspension (%s)",
    async (_label, mutate, reason) => {
      const f = await aCycleInvoice();
      const event = invoiceCreated(f);
      mutate(f);
      await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow(
        "operator required before suspension",
      );
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason,
        suspendedAt: null,
      });
      await runRecovery();
      expect((await receipt(event.id))?.result).toBe("reconciliation_required");
      expect(harness.state.calls).toMatchObject({
        update: 0,
        finalizeEffects: 0,
      });
    },
  );

  it("recovers a failed task insert through bounded discovery, ignoring foreign, manual and older drafts", async () => {
    const f = await aCycleInvoice();
    const manual = await aCycleInvoice({ auto_advance: false });
    const older = await aCycleInvoice({ created: PERIOD_END - 86_400 });
    const foreignSubscription = `sub_foreign_${randomUUID().slice(0, 6)}`;
    harness.state.invoices.set("in_foreign", {
      ...structuredClone(invoice(f.invoiceId)!),
      id: "in_foreign",
      parent: { subscription_details: { subscription: foreignSubscription } },
    });
    vi.spyOn(
      InvoiceLineInjectionModel.prototype,
      "register",
    ).mockRejectedValueOnce(new Error("connection lost"));
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow(
      "connection lost",
    );
    expect(await task(f.invoiceId)).toBeUndefined();

    await runRecovery();
    expect(await task(f.invoiceId)).toBeUndefined();

    harness.state.since = new Date(PERIOD_END * 1000);
    await runRecovery(2);
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect((await task(f.invoiceId))?.source).toBe("discovery");
    for (const untouched of [manual.invoiceId, older.invoiceId, "in_foreign"]) {
      expect(await task(untouched)).toBeUndefined();
    }
    expect(invoice(manual.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: false,
    });
    expect(invoice(older.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: true,
    });
    expect(invoice("in_foreign")).toMatchObject({
      status: "draft",
      auto_advance: true,
    });
  });

  it("completes a partial injection without duplicating lines", async () => {
    const f = await aCycleInvoice();
    harness.state.faults.set("item:cloud:included-credit", 3);
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    expect(managedKeys(f.invoiceId)).toEqual(["cloud:usage-cpu-minutes=16"]);
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
  });

  it.each(["finalize:before", "finalize:after"])(
    "recognizes its own finalization after %s without a second finalization",
    async (point) => {
      const f = await aCycleInvoice();
      harness.state.faults.set(point, 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      await runRecovery(2);
      expect((await task(f.invoiceId))?.state).toBe("finalized");
      expect(harness.state.calls).toMatchObject({ finalizeEffects: 1, pay: 0 });
    },
  );

  it("recognizes its finalization when the process died before recording it", async () => {
    const f = await aCycleInvoice();
    const advance = InvoiceLineInjectionModel.prototype.advance;
    vi.spyOn(InvoiceLineInjectionModel.prototype, "advance").mockImplementation(
      function (this: InvoiceLineInjectionModel, lease, patch) {
        if (patch.state === "finalized") throw new Error("process died");
        return advance.call(this, lease, patch);
      },
    );
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("finalizing");
    expect(invoice(f.invoiceId)?.status).toBe("open");
    vi.restoreAllMocks();
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(harness.state.calls.finalizeEffects).toBe(1);
  });

  it.each([
    ["void", "finalized_as:void"],
    ["uncollectible", "finalized_as:uncollectible"],
  ])(
    "does not mistake a %s invoice for its success",
    async (status, reason) => {
      const f = await aCycleInvoice();
      harness.state.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect((await task(f.invoiceId))?.state).toBe("finalizing");
      invoice(f.invoiceId)!.status = status;
      await runRecovery();
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason,
      });
    },
  );

  it("does not mistake an externally changed finalized invoice for its success", async () => {
    const f = await aCycleInvoice();
    harness.state.faults.set("finalize:before", 1);
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    const inv = invoice(f.invoiceId)!;
    harness.state.items.find((i) => i.invoice === f.invoiceId)!.amount += 1;
    inv.status = "open";
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "needs_operator",
      reason: "finalized_with_external_changes:open",
    });
  });

  it.each([
    [
      "amount",
      (item: any) => {
        item.amount += 1;
      },
    ],
    [
      "currency",
      (item: any) => {
        item.currency = "usd";
      },
    ],
    [
      "period",
      (item: any) => {
        item.period.start += 60;
      },
    ],
    [
      "provider",
      (item: any) => {
        item.metadata.saasLineProvider = "other";
      },
    ],
  ])(
    "never finalizes a draft whose line %s changed while stopped in finalizing",
    async (_label, mutate) => {
      const f = await aCycleInvoice();
      harness.state.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect((await task(f.invoiceId))?.state).toBe("finalizing");
      mutate(harness.state.items.find((i) => i.invoice === f.invoiceId));
      await runRecovery(2);
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason: "before_finalize:changed_since_verified",
      });
      expect(harness.state.calls.finalizeEffects).toBe(0);
      expect(invoice(f.invoiceId)?.status).toBe("draft");
    },
  );

  it.each([
    [
      "an extra managed line",
      (f: Fixture) => {
        const item = harness.state.items.find(
          (i) => i.invoice === f.invoiceId,
        )!;
        harness.state.items.push({ ...structuredClone(item), id: "ii_extra" });
      },
      "before_finalize:changed_since_verified",
    ],
    [
      "automatic advancement turned back on",
      (f: Fixture) => {
        invoice(f.invoiceId)!.auto_advance = true;
      },
      "before_finalize:left_suspension:draft/auto_advance=true",
    ],
    [
      "another customer",
      (f: Fixture) => {
        invoice(f.invoiceId)!.customer = "cus_other";
      },
      "before_finalize:identity_customer",
    ],
  ])(
    "never finalizes after %s while stopped in finalizing",
    async (_label, mutate, reason) => {
      const f = await aCycleInvoice();
      harness.state.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      mutate(f);
      await runRecovery();
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason,
      });
      expect(harness.state.calls.finalizeEffects).toBe(0);
    },
  );

  it.each([
    ["duplicate", "managed_lines_duplicate"],
    ["currency", "managed_lines_unexpected_or_changed"],
  ] as const)(
    "hands a %s Stripe line to an operator instead of retrying forever",
    async (quirk, reason) => {
      const f = await aCycleInvoice();
      harness.state.createQuirk = quirk;
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason,
      });
      expect(harness.state.calls.finalizeEffects).toBe(0);
    },
  );

  it("keeps foreign items untouched and outside the fingerprint", async () => {
    const f = await aCycleInvoice();
    harness.state.items.push({
      id: "ii_foreign",
      invoice: f.invoiceId,
      amount: 999,
      currency: "eur",
      period: { start: 0, end: 0 },
      metadata: {},
    });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(
      harness.state.items.find((i) => i.id === "ii_foreign"),
    ).toMatchObject({ amount: 999, metadata: {} });
    expect((await task(f.invoiceId))?.fingerprint).not.toContain("999");
  });

  it("leaves blocked usage to an operator and not-ready usage suspended, never finalizing either", async () => {
    const blocked = await aCycleInvoice();
    harness.state.resolve = () => ({
      status: "blocked",
      reason: "written_off_hour",
    });
    await dispatchStripeWebhookEvent(invoiceCreated(blocked));
    await runRecovery(3);
    expect(await task(blocked.invoiceId)).toMatchObject({
      state: "needs_operator",
      reason: "provider_blocked:cloud:written_off_hour",
    });
    expect(invoice(blocked.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: false,
    });

    const waiting = await aCycleInvoice();
    harness.state.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(waiting));
    await runRecovery(3);
    expect((await task(waiting.invoiceId))?.state).toBe("suspended");
    expect(harness.state.calls.finalizeEffects).toBe(0);
  });
  it.each([
    ["undefined", undefined],
    ["ready without lines", { status: "ready" }],
    ["unknown status", { status: "done", lines: [] }],
  ])(
    "treats a malformed resolution (%s) as blocked, never as an empty bill",
    async (_label, answer) => {
      const f = await aCycleInvoice();
      harness.state.resolve = () => answer;
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      await runRecovery(3);
      expect(await task(f.invoiceId)).toMatchObject({
        state: "needs_operator",
        reason: "provider_blocked:cloud:invalid_resolution",
      });
      expect(harness.state.calls).toMatchObject({
        itemCreates: 0,
        finalizeEffects: 0,
      });
    },
  );
});

describe("invoice line recovery — expected providers", () => {
  it("waits for a provider that disappeared before the resumption, never finalizing without it", async () => {
    const f = await aCycleInvoice();
    harness.state.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.providerIds).toEqual(["cloud"]);
    harness.state.providers = [];
    harness.state.resolve = () => LINES;
    await runRecovery(3);
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      lastError: "provider_missing:cloud",
    });
    expect(harness.state.calls).toMatchObject({
      itemCreates: 0,
      finalizeEffects: 0,
    });
    harness.state.providers = ["cloud"];
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
  });

  it("bills both providers, and waits while either is missing", async () => {
    const f = await aCycleInvoice();
    harness.state.providers = ["cloud", "storage"];
    harness.state.otherResolve = () => [
      { key: "volume-gb-hours", description: "Volume", amountCents: 7 },
    ];
    harness.state.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.providerIds).toEqual([
      "cloud",
      "storage",
    ]);
    harness.state.resolve = () => LINES;
    harness.state.providers = ["cloud"];
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      lastError: "provider_missing:storage",
    });
    expect(harness.state.calls.itemCreates).toBe(0);
    harness.state.providers = ["storage", "cloud"];
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
      "storage:volume-gb-hours=7",
    ]);
  });

  it("waits for a configured provider not yet registered when invoice.created arrives", async () => {
    const f = await aCycleInvoice();
    harness.state.required = ["cloud"];
    harness.state.providers = [];
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      providerIds: ["cloud"],
    });
    expect((await receipt(event.id))?.result).toBe("success");
    expect(harness.state.calls.finalizeEffects).toBe(0);
    harness.state.providers = ["cloud"];
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
  });
});

describe("invoice line recovery — paid-usage window", () => {
  it("asks the provider for the clipped paid window only", async () => {
    const f = await aCycleInvoice();
    const paidStart = new Date((PERIOD_START + 3_600) * 1000);
    await GetModel(TenantSubscriptionModel, f.tenantId).update(f.tenantId, {
      paidUsagePeriods: [
        { stripeSubscriptionId: f.subscriptionId, start: paidStart, end: null },
      ],
    } as never);
    const seen: unknown[] = [];
    harness.state.resolve = (ctx) => {
      seen.push(ctx);
      return LINES;
    };
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect(seen[0]).toMatchObject({
      periodStart: paidStart,
      periodEnd: new Date(PERIOD_END * 1000),
    });
  });

  it.each([true, false])(
    "never registers, suspends or resolves an uncovered gifted or grace window (marker %s)",
    async (isComplimentary) => {
      const f = await aCycleInvoice();
      await GetModel(TenantSubscriptionModel, f.tenantId).update(f.tenantId, {
        isComplimentary,
        paidUsagePeriods: [],
      } as never);
      const resolve = vi.fn(() => LINES);
      harness.state.resolve = resolve;
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect(await task(f.invoiceId)).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
      expect(harness.state.calls).toMatchObject({
        update: 0,
        itemCreates: 0,
        finalizeEffects: 0,
      });
    },
  );
});

describe("invoice line recovery — real concurrency on MongoDB", () => {
  it("lets one holder act when the handler and many workers race on one invoice", async () => {
    const f = await aCycleInvoice();
    harness.state.latencyMs = 15;
    const event = invoiceCreated(f);
    const tasksModel = tasks();
    await GetModel(TenantSubscriptionModel, f.tenantId).findOne();
    const racers = [
      dispatchStripeWebhookEvent(event).catch(() => "handler-500"),
      // Staggered so later racers read the task while an earlier holder is
      // mid-call on Stripe, not only the revision every racer started from.
      ...Array.from({ length: 12 }, async (_, i) => {
        await new Promise((r) => setTimeout(r, i * 7));
        await tasksModel.get(f.invoiceId);
        return processInvoiceLineInjection(f.invoiceId);
      }),
    ];
    await Promise.all(racers);
    for (
      let i = 0;
      i < 4 && (await task(f.invoiceId))?.state !== "finalized";
      i += 1
    ) {
      await Promise.all(
        Array.from({ length: 6 }, () =>
          processInvoiceLineInjection(f.invoiceId),
        ),
      );
    }
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(harness.state.calls).toMatchObject({
      update: 1,
      itemCreates: 2,
      finalizeEffects: 1,
      pay: 0,
    });
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
  });

  it("fences a stalled holder whose lease expired: it never touches Stripe after the takeover", async () => {
    const f = await aCycleInvoice();
    harness.state.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    const stalled = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    let resolveCalls = 0;
    harness.state.resolve = async () => {
      resolveCalls += 1;
      if (resolveCalls === 1) {
        entered.resolve();
        await stalled.promise;
      }
      return LINES;
    };
    const stalledHolder = processInvoiceLineInjection(f.invoiceId);
    await entered.promise;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + INVOICE_LINE_LEASE_MS + 1_000);
    // The takeover gets as far as Stripe refusing the first line, so lines are
    // still missing when the stalled holder wakes up: an unfenced holder would
    // create them.
    harness.state.faults.set("item:cloud:usage-cpu-minutes", 3);
    await processInvoiceLineInjection(f.invoiceId);
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    const callsAfterTakeover = { ...harness.state.calls };
    stalled.resolve();
    await stalledHolder;
    expect(harness.state.calls).toEqual(callsAfterTakeover);
    expect(managedKeys(f.invoiceId)).toEqual([]);
    await processInvoiceLineInjection(f.invoiceId);
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(harness.state.calls).toMatchObject({
      itemCreates: 2,
      finalizeEffects: 1,
    });
  });
});
