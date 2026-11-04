import { GetModel } from "@antelopejs/interface-database-decorators";
import { describe, expect, it, vi } from "vitest";
import { TenantSubscriptionModel } from "../src/db";
import {
  INVOICE_LINE_LEASE_MS,
  processInvoiceLineInjection,
} from "../src/invoice-line-items/recovery";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { latch } from "./helpers/latch";
import { useMongoDatabase } from "./helpers/mongo";
import {
  aCycleInvoice,
  invoiceCreated,
  LINES,
  managedKeys,
  task,
  tasks,
  useInvoiceLineRecovery,
  world,
} from "./helpers/invoice-line-recovery";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("invoice-line-recovery-concurrency");
const stripe = useSuiteStripe();
useInvoiceLineRecovery(stripe);

/**
 * Stripe refuses the first line of the takeover, so lines are still missing
 * when the stalled holder wakes up: an unfenced holder would create them.
 */
function refuseFirstLine(): void {
  world.faults.set("item:cloud:usage-cpu-minutes", 3);
}

describe("invoice line recovery — real concurrency on MongoDB", () => {
  it("lets one holder act when the handler and many workers race on one invoice", async () => {
    const f = await aCycleInvoice();
    world.latencyMs = 15;
    const event = invoiceCreated(f);
    const tasksModel = tasks();
    await GetModel(TenantSubscriptionModel, f.tenantId).findOne();
    const racers = [
      dispatchStripeWebhookEvent(event).catch(() => "handler-500"),
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
    expect(world.calls).toMatchObject({
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
    world.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    const stalled = latch();
    const entered = latch();
    let resolveCalls = 0;
    world.resolve = async () => {
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
    refuseFirstLine();
    await processInvoiceLineInjection(f.invoiceId);
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    const callsAfterTakeover = { ...world.calls };
    stalled.resolve();
    await stalledHolder;
    expect(world.calls).toEqual(callsAfterTakeover);
    expect(managedKeys(f.invoiceId)).toEqual([]);
    await processInvoiceLineInjection(f.invoiceId);
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(world.calls).toMatchObject({
      itemCreates: 2,
      finalizeEffects: 1,
    });
  });
});
