import { GetModel } from "@antelopejs/interface-database-decorators";
import type { InvoiceLineItemsContext } from "@antelopejs/interface-dms-saas/invoice-line-items";
import { describe, expect, it, vi } from "vitest";
import { TenantSubscriptionModel } from "../src/db";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { useMongoDatabase } from "./helpers/mongo";
import {
  aCycleInvoice,
  invoiceCreated,
  LINES,
  managedKeys,
  PERIOD_END,
  PERIOD_START,
  receipt,
  runRecovery,
  setProviders,
  configureRecovery,
  task,
  useInvoiceLineRecovery,
  world,
} from "./helpers/invoice-line-recovery";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("invoice-line-recovery-providers");
const stripe = useSuiteStripe();
useInvoiceLineRecovery(stripe);

describe("invoice line recovery — expected providers", () => {
  it("waits for a provider that disappeared before the resumption, not finalizing without it before the deadline", async () => {
    const f = await aCycleInvoice();
    world.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.providerIds).toEqual(["cloud"]);
    setProviders([]);
    world.resolve = () => LINES;
    await runRecovery(3);
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      lastError: "provider_missing:cloud",
    });
    expect(world.calls).toMatchObject({
      itemCreates: 0,
      finalizeEffects: 0,
    });
    setProviders(["cloud"]);
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
  });

  it("bills both providers, and waits while either is missing", async () => {
    const f = await aCycleInvoice();
    setProviders(["cloud", "storage"]);
    world.otherResolve = () => [
      { key: "volume-gb-hours", description: "Volume", amountCents: 7 },
    ];
    world.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.providerIds).toEqual([
      "cloud",
      "storage",
    ]);
    world.resolve = () => LINES;
    setProviders(["cloud"]);
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      lastError: "provider_missing:storage",
    });
    expect(world.calls.itemCreates).toBe(0);
    setProviders(["storage", "cloud"]);
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
    configureRecovery({ required: ["cloud"] });
    setProviders([]);
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      providerIds: ["cloud"],
    });
    expect((await receipt(event.id))?.result).toBe("success");
    expect(world.calls.finalizeEffects).toBe(0);
    setProviders(["cloud"]);
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
    });
    const seen: InvoiceLineItemsContext[] = [];
    world.resolve = (ctx) => {
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
      });
      const resolve = vi.fn(() => LINES);
      world.resolve = resolve;
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect(await task(f.invoiceId)).toBeUndefined();
      expect(resolve).not.toHaveBeenCalled();
      expect(world.calls).toMatchObject({
        update: 0,
        itemCreates: 0,
        finalizeEffects: 0,
      });
    },
  );
});
