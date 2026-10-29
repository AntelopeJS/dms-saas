import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db/models/stripeWebhookEvents.model";
import type {
  InvoiceLineItemsResolver,
  InvoiceUsageGap,
} from "@antelopejs/interface-dms-saas/invoice-line-items";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { afterEach, beforeEach, vi } from "vitest";
import { setRuntimeConfig } from "../../src/config/runtime";
import { TenantSubscriptionModel } from "../../src/db";
import { internal as lineItemsRegistry } from "../../src/implementations/dms-saas/invoice-line-items";
import {
  InvoiceLineInjectionModel,
  reconcileInvoiceLineInjections,
} from "../../src/invoice-line-items/recovery";
import { INVOICE_LINE_DEADLINE_MS } from "../../src/invoice-line-items/recovery/process";
import { STRIPE_CONFIG } from "./upcoming-invoice";
import type { SuiteStripe } from "./stripe";

export const PERIOD_START = 1_792_266_817;
export const PERIOD_END = 1_794_945_217;
export const LINES = [
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

const PROVIDER_IDS = ["cloud", "storage"];

/** A draft invoice of the simulated Stripe account. */
export interface FakeInvoice {
  id: string;
  object: "invoice";
  customer: string;
  currency: string;
  status: NonNullable<Stripe.Invoice["status"]>;
  auto_advance: boolean;
  billing_reason: NonNullable<Stripe.Invoice["billing_reason"]>;
  created: number;
  period_start: number;
  period_end: number;
  parent: { subscription_details: { subscription: string } };
  total: number;
  subtotal: number;
  amount_due: number;
  metadata: Record<string, string>;
  status_transitions: Record<string, number>;
  lines: { data: Stripe.InvoiceLineItem[] };
}

/** An invoice item of the simulated Stripe account. */
export interface FakeItem {
  id: string;
  invoice: string;
  amount: number;
  currency: string;
  period: { start: number; end: number };
  metadata: Record<string, string>;
}

interface World {
  invoices: Map<string, FakeInvoice>;
  items: FakeItem[];
  finalizations: Map<string, FakeInvoice>;
  itemCreations: Map<string, FakeItem>;
  faults: Map<string, number>;
  latencyMs: number;
  calls: {
    update: number;
    finalizeEffects: number;
    itemCreates: number;
    pay: number;
  };
  resolve: InvoiceLineItemsResolver;
  otherResolve: InvoiceLineItemsResolver;
  gaps: Array<{ provider: string; gap: InvoiceUsageGap }>;
  /** Stripe misbehaving on create: duplicate the item, or store another currency. */
  createQuirk: null | "duplicate" | "currency";
}

/** The simulated Stripe account and the usage providers' behaviour. */
export const world: World = {
  invoices: new Map(),
  items: [],
  finalizations: new Map(),
  itemCreations: new Map(),
  faults: new Map(),
  latencyMs: 0,
  calls: { update: 0, finalizeEffects: 0, itemCreates: 0, pay: 0 },
  resolve: () => [],
  otherResolve: () => [],
  gaps: [],
  createQuirk: null,
};

function resetWorld(): void {
  world.invoices.clear();
  world.items = [];
  world.finalizations.clear();
  world.itemCreations.clear();
  world.faults.clear();
  world.latencyMs = 0;
  world.calls = { update: 0, finalizeEffects: 0, itemCreates: 0, pay: 0 };
  world.resolve = () => LINES;
  world.otherResolve = () => [];
  world.gaps = [];
  world.createQuirk = null;
}

function isRange(
  value: number | Stripe.RangeQueryParam | undefined,
): value is Stripe.RangeQueryParam {
  return typeof value === "object";
}

function createdSince(
  created: number | Stripe.RangeQueryParam | undefined,
): number {
  return isRange(created) ? (created.gte ?? 0) : (created ?? 0);
}

function stringMetadata(
  metadata: Stripe.Emptyable<Stripe.MetadataParam> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, world.latencyMs));
}

function fault(point: string): void {
  const remaining = world.faults.get(point) ?? 0;
  if (remaining === 0) return;
  world.faults.set(point, remaining - 1);
  throw new Error(`simulated Stripe failure at ${point}`);
}

export function fakeInvoice(id: string): FakeInvoice {
  const invoice = world.invoices.get(id);
  if (!invoice) throw new Error(`The simulated Stripe holds no invoice ${id}`);
  return invoice;
}

/** The first invoice item of the invoice. */
export function firstItem(invoiceId: string): FakeItem {
  const item = world.items.find((candidate) => candidate.invoice === invoiceId);
  if (!item) throw new Error(`Invoice ${invoiceId} has no item`);
  return item;
}

export function managedKeys(invoiceId: string): string[] {
  return world.items
    .filter((item) => item.invoice === invoiceId)
    .map((item) => `${item.metadata.saasLineKey}=${item.amount}`)
    .sort();
}

/** Makes the simulated account answer the calls the recovery makes on `client`. */
function installStripeFake(client: Stripe): void {
  vi.spyOn(client.invoices, "retrieve").mockImplementation(async (id) => {
    await pause();
    fault("retrieve");
    return fromPartial(structuredClone(fakeInvoice(id)));
  });
  vi.spyOn(client.invoices, "update").mockImplementation(async (id, params) => {
    await pause();
    fault("update:before");
    const invoice = fakeInvoice(id);
    if (invoice.status !== "draft") throw new Error("invoice_not_editable");
    world.calls.update += 1;
    invoice.auto_advance = params?.auto_advance ?? invoice.auto_advance;
    fault("update:after");
    return fromPartial(structuredClone(invoice));
  });
  vi.spyOn(client.invoices, "finalizeInvoice").mockImplementation(
    async (id, params, options) => {
      await pause();
      fault("finalize:before");
      const key = options?.idempotencyKey ?? "";
      const replayed = world.finalizations.get(key);
      if (replayed) return fromPartial(structuredClone(replayed));
      const invoice = fakeInvoice(id);
      if (invoice.status !== "draft")
        throw new Error("invoice_already_finalized");
      invoice.status = "open";
      invoice.auto_advance = params?.auto_advance ?? invoice.auto_advance;
      world.calls.finalizeEffects += 1;
      world.finalizations.set(key, structuredClone(invoice));
      fault("finalize:after");
      return fromPartial(structuredClone(invoice));
    },
  );
  vi.spyOn(client.invoices, "pay").mockImplementation(async () => {
    world.calls.pay += 1;
    return fromPartial({});
  });
  vi.spyOn(client.invoices, "list").mockImplementation((params) => {
    const matching = [...world.invoices.values()].filter(
      (invoice) =>
        invoice.parent.subscription_details.subscription ===
          params?.subscription &&
        invoice.status === params.status &&
        invoice.created >= createdSince(params?.created),
    );
    return fromPartial({
      async *[Symbol.asyncIterator]() {
        for (const invoice of matching) yield structuredClone(invoice);
      },
    });
  });
  vi.spyOn(client.invoiceItems, "list").mockImplementation((params) => {
    const matching = world.items.filter(
      (item) => item.invoice === params?.invoice,
    );
    return fromPartial({
      async *[Symbol.asyncIterator]() {
        for (const item of matching) yield structuredClone(item);
      },
    });
  });
  vi.spyOn(client.invoiceItems, "create").mockImplementation(
    async (params, options) => {
      await pause();
      const metadata = stringMetadata(params?.metadata);
      fault(`item:${metadata.saasLineKey}`);
      const key = options?.idempotencyKey ?? "";
      const replayed = world.itemCreations.get(key);
      if (replayed) return fromPartial(replayed);
      const invoice = fakeInvoice(String(params?.invoice));
      if (invoice.status !== "draft") throw new Error("invoice_not_editable");
      const item: FakeItem = {
        id: `ii_${world.items.length}`,
        invoice: invoice.id,
        amount: params?.amount ?? 0,
        currency:
          world.createQuirk === "currency" ? "usd" : (params?.currency ?? ""),
        period: {
          start: params?.period?.start ?? 0,
          end: params?.period?.end ?? 0,
        },
        metadata,
      };
      world.items.push(item);
      if (world.createQuirk === "duplicate")
        world.items.push({ ...item, id: `${item.id}_dup` });
      world.calls.itemCreates += 1;
      world.itemCreations.set(key, item);
      return fromPartial(item);
    },
  );
}

/**
 * Registers the usage providers by id, replacing the ones registered: `cloud`
 * resolves with `world.resolve`, any other with `world.otherResolve`, and each
 * records the gaps it is told of.
 *
 * @param ids Providers that are registered, in registration order
 */
export function setProviders(ids: readonly string[]): void {
  for (const id of PROVIDER_IDS) {
    lineItemsRegistry.RegisterInvoiceLineItemsProvider.unregister(id);
  }
  for (const id of ids) {
    lineItemsRegistry.RegisterInvoiceLineItemsProvider.register(id, {
      id,
      resolve: (context) =>
        id === "cloud" ? world.resolve(context) : world.otherResolve(context),
      onUsageGap: (gap) => world.gaps.push({ provider: id, gap }),
    });
  }
}

/** Sets the recovery's runtime configuration. */
export function configureRecovery(
  options: { since?: Date; required?: string[] } = {},
): void {
  setRuntimeConfig({
    stripe: STRIPE_CONFIG,
    invoiceLineRecoveryDiscoverySince: options.since?.toISOString(),
    invoiceLineRequiredProviders: options.required,
  });
}

/**
 * Starts each test of the file calling it at the top level with an empty
 * simulated Stripe account, the `cloud` provider registered and no discovery
 * nor required provider configured.
 *
 * @param stripe The suite's Stripe clients, from `useSuiteStripe`
 */
export function useInvoiceLineRecovery(stripe: SuiteStripe): void {
  beforeEach(() => {
    resetWorld();
    installStripeFake(stripe.write);
    installStripeFake(stripe.read);
    setProviders(["cloud"]);
    configureRecovery();
  });
  afterEach(() => {
    vi.useRealTimers();
    setProviders([]);
  });
}

/** A workspace with a draft cycle invoice on the simulated account. */
export interface Fixture {
  tenantId: string;
  customerId: string;
  subscriptionId: string;
  invoiceId: string;
}

export async function aCycleInvoice(
  overrides: Partial<FakeInvoice> = {},
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
  });
  world.invoices.set(invoiceId, {
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

export function invoiceCreated(
  fixture: Fixture,
  eventId = `evt_${randomUUID()}`,
): Stripe.InvoiceCreatedEvent {
  return fromPartial<Stripe.InvoiceCreatedEvent>({
    id: eventId,
    object: "event",
    type: "invoice.created",
    data: { object: structuredClone(fakeInvoice(fixture.invoiceId)) },
  });
}

export const tasks = () => GetModel(InvoiceLineInjectionModel);
export const task = (id: string) => tasks().get(id);
export const receipt = (id: string) =>
  GetModel(StripeWebhookEventModel).get(id);

/** Moves the clock past the deadline lines still missing are waited for. */
export function passTheDeadline(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + INVOICE_LINE_DEADLINE_MS + 1_000);
}

/** Runs the recovery cron `times` times, a day apart. */
export async function runRecovery(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1)
    await reconcileInvoiceLineInjections(
      new Date(Date.now() + 24 * 3_600_000 * (i + 1)),
    );
}
