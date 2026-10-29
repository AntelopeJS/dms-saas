import { randomUUID } from "node:crypto";
import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import { useMongoDatabase } from "./helpers/mongo";
import {
  aCycleInvoice,
  configureRecovery,
  type FakeItem,
  type Fixture,
  fakeInvoice,
  firstItem,
  invoiceCreated,
  LINES,
  managedKeys,
  PERIOD_END,
  passTheDeadline,
  receipt,
  runRecovery,
  setProviders,
  task,
  tasks,
  useInvoiceLineRecovery,
  world,
} from "./helpers/invoice-line-recovery";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("invoice-line-recovery");
const stripe = useSuiteStripe();
useInvoiceLineRecovery(stripe);

describe("invoice line recovery — chain with the MongoDB provider and a simulated Stripe", () => {
  it("acknowledges after confirmed suspension, waits while coverage is missing, then injects and finalizes once", async () => {
    const f = await aCycleInvoice();
    world.resolve = () => {
      throw new Error(
        "Usage of workspace is not fully accounted for from 2026-11-18T18:00:00.000Z",
      );
    };
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect((await receipt(event.id))?.result).toBe("success");
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    expect(fakeInvoice(f.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: false,
    });
    expect(managedKeys(f.invoiceId)).toEqual([]);

    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("suspended");
    expect((await task(f.invoiceId))?.lastError).toContain("provider_failed");

    world.resolve = () => LINES;
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(managedKeys(f.invoiceId)).toEqual([
      "cloud:included-credit=-10",
      "cloud:usage-cpu-minutes=16",
    ]);
    expect(fakeInvoice(f.invoiceId)).toMatchObject({
      status: "open",
      auto_advance: true,
    });
    expect(world.calls).toMatchObject({
      finalizeEffects: 1,
      itemCreates: 2,
      pay: 0,
    });

    await dispatchStripeWebhookEvent(event);
    await runRecovery();
    expect(world.calls).toMatchObject({
      finalizeEffects: 1,
      itemCreates: 2,
    });
  });

  it("refuses to acknowledge an unconfirmed suspension, and the task — not a redelivery — completes it and closes the receipt", async () => {
    const f = await aCycleInvoice();
    world.faults.set("update:before", 1);
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow(
      "suspension not confirmed",
    );
    expect((await receipt(event.id))?.result).toBe("reconciliation_required");
    expect((await task(f.invoiceId))?.state).toBe("registered");
    expect(fakeInvoice(f.invoiceId).auto_advance).toBe(true);

    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect((await receipt(event.id))?.result).toBe("success");
    await expect(dispatchStripeWebhookEvent(event)).resolves.toBeUndefined();
  });

  it("confirms a suspension whose response was lost by reading Stripe back", async () => {
    const f = await aCycleInvoice();
    world.faults.set("update:after", 1);
    const event = invoiceCreated(f);
    await dispatchStripeWebhookEvent(event);
    expect((await task(f.invoiceId))?.state).not.toBe("registered");
    expect(world.calls.update).toBe(1);
  });

  it("records a draft Stripe finalized before suspension as finalized with a gap, and closes the receipt", async () => {
    const f = await aCycleInvoice();
    world.faults.set("update:before", 1);
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow();
    fakeInvoice(f.invoiceId).status = "open";
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "finalized",
      usageGaps: ["finalized_before_suspension:open/auto_advance=true"],
      suspendedAt: null,
    });
    expect((await receipt(event.id))?.result).toBe("success");
    expect(world.calls.finalizeEffects).toBe(0);
    expect(world.gaps).toMatchObject([
      {
        provider: "cloud",
        gap: {
          tenantId: f.tenantId,
          invoiceId: f.invoiceId,
          reasons: ["finalized_before_suspension:open/auto_advance=true"],
        },
      },
    ]);
  });

  it.each([
    [
      "already finalized",
      (f: Fixture) => {
        fakeInvoice(f.invoiceId).status = "open";
      },
      "finalized_before_suspension:open/auto_advance=true",
      0,
    ],
    [
      "another customer",
      (f: Fixture) => {
        fakeInvoice(f.invoiceId).customer = "cus_other";
      },
      "identity_mismatch:customer",
      0,
    ],
  ])(
    "closes without lines, never finalizing a foreign draft, when the draft is unexpected before suspension (%s)",
    async (_label, mutate, reason, finalizeEffects) => {
      const f = await aCycleInvoice();
      const event = invoiceCreated(f);
      mutate(f);
      await dispatchStripeWebhookEvent(event);
      expect(await task(f.invoiceId)).toMatchObject({
        state: "finalized",
        usageGaps: [reason],
        suspendedAt: null,
      });
      expect((await receipt(event.id))?.result).toBe("success");
      expect(world.calls).toMatchObject({
        update: 0,
        itemCreates: 0,
        finalizeEffects,
      });
    },
  );

  it("recovers a failed task insert through bounded discovery, ignoring foreign, manual and older drafts", async () => {
    const f = await aCycleInvoice();
    const manual = await aCycleInvoice({ auto_advance: false });
    const older = await aCycleInvoice({ created: PERIOD_END - 86_400 });
    const foreignSubscription = `sub_foreign_${randomUUID().slice(0, 6)}`;
    world.invoices.set("in_foreign", {
      ...structuredClone(fakeInvoice(f.invoiceId)),
      id: "in_foreign",
      parent: { subscription_details: { subscription: foreignSubscription } },
    });
    vi.spyOn(tasks(), "register").mockRejectedValueOnce(
      new Error("connection lost"),
    );
    const event = invoiceCreated(f);
    await expect(dispatchStripeWebhookEvent(event)).rejects.toThrow(
      "connection lost",
    );
    expect(await task(f.invoiceId)).toBeUndefined();

    await runRecovery();
    expect(await task(f.invoiceId)).toBeUndefined();

    configureRecovery({ since: new Date(PERIOD_END * 1000) });
    await runRecovery(2);
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect((await task(f.invoiceId))?.source).toBe("discovery");
    for (const untouched of [manual.invoiceId, older.invoiceId, "in_foreign"]) {
      expect(await task(untouched)).toBeUndefined();
    }
    expect(fakeInvoice(manual.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: false,
    });
    expect(fakeInvoice(older.invoiceId)).toMatchObject({
      status: "draft",
      auto_advance: true,
    });
    expect(fakeInvoice("in_foreign")).toMatchObject({
      status: "draft",
      auto_advance: true,
    });
  });

  it("completes a partial injection without duplicating lines", async () => {
    const f = await aCycleInvoice();
    world.faults.set("item:cloud:included-credit", 3);
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
      world.faults.set(point, 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      await runRecovery(2);
      expect((await task(f.invoiceId))?.state).toBe("finalized");
      expect(world.calls).toMatchObject({ finalizeEffects: 1, pay: 0 });
    },
  );

  it("recognizes its finalization when the process died before recording it", async () => {
    const f = await aCycleInvoice();
    const advance = tasks().advance.bind(tasks());
    const processDied = vi
      .spyOn(tasks(), "advance")
      .mockImplementation((lease, patch) => {
        if (patch.state === "finalized") throw new Error("process died");
        return advance(lease, patch);
      });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("finalizing");
    expect(fakeInvoice(f.invoiceId).status).toBe("open");
    processDied.mockRestore();
    await runRecovery();
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(world.calls.finalizeEffects).toBe(1);
  });

  it.each([
    ["void", "finalized_as:void"],
    ["uncollectible", "finalized_as:uncollectible"],
  ] as const)(
    "reports a %s invoice as a gap, not as its success",
    async (status, reason) => {
      const f = await aCycleInvoice();
      world.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect((await task(f.invoiceId))?.state).toBe("finalizing");
      fakeInvoice(f.invoiceId).status = status;
      await runRecovery();
      expect(await task(f.invoiceId)).toMatchObject({
        state: "finalized",
        usageGaps: [reason],
      });
    },
  );

  it("reports an externally changed finalized invoice as a gap", async () => {
    const f = await aCycleInvoice();
    world.faults.set("finalize:before", 1);
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    const inv = fakeInvoice(f.invoiceId);
    firstItem(f.invoiceId).amount += 1;
    inv.status = "open";
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "finalized",
      usageGaps: ["finalized_with_external_changes:open"],
    });
  });

  it.each([
    [
      "amount",
      (item: FakeItem) => {
        item.amount += 1;
      },
    ],
    [
      "currency",
      (item: FakeItem) => {
        item.currency = "usd";
      },
    ],
    [
      "period",
      (item: FakeItem) => {
        item.period.start += 60;
      },
    ],
    [
      "provider",
      (item: FakeItem) => {
        item.metadata.saasLineProvider = "other";
      },
    ],
  ])(
    "finalizes a draft whose line %s changed while stopped in finalizing, reporting the change once",
    async (_label, mutate) => {
      const f = await aCycleInvoice();
      world.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect((await task(f.invoiceId))?.state).toBe("finalizing");
      mutate(firstItem(f.invoiceId));
      await runRecovery(2);
      expect(await task(f.invoiceId)).toMatchObject({
        state: "finalized",
        usageGaps: ["before_finalize:changed_since_verified"],
      });
      expect(world.calls.finalizeEffects).toBe(1);
      expect(fakeInvoice(f.invoiceId).status).toBe("open");
      expect(world.gaps).toHaveLength(1);
    },
  );

  it.each([
    [
      "an extra managed line",
      (f: Fixture) => {
        world.items.push({
          ...structuredClone(firstItem(f.invoiceId)),
          id: "ii_extra",
        });
      },
      "before_finalize:changed_since_verified",
    ],
    [
      "automatic advancement turned back on",
      (f: Fixture) => {
        fakeInvoice(f.invoiceId).auto_advance = true;
      },
      "before_finalize:left_suspension:draft/auto_advance=true",
    ],
  ])(
    "finalizes anyway after %s while stopped in finalizing",
    async (_label, mutate, reason) => {
      const f = await aCycleInvoice();
      world.faults.set("finalize:before", 1);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      mutate(f);
      await runRecovery();
      expect(await task(f.invoiceId)).toMatchObject({
        state: "finalized",
        usageGaps: [reason],
      });
      expect(world.calls.finalizeEffects).toBe(1);
    },
  );

  it.each([
    ["duplicate", "managed_lines_duplicate"],
    ["currency", "managed_lines_unexpected_or_changed"],
  ] as const)(
    "finalizes with a %s Stripe line, reporting it, instead of retrying forever",
    async (quirk, reason) => {
      const f = await aCycleInvoice();
      world.createQuirk = quirk;
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      expect(await task(f.invoiceId)).toMatchObject({
        state: "finalized",
        usageGaps: [reason],
      });
      expect(world.calls.finalizeEffects).toBe(1);
    },
  );

  it("never finalizes a draft that became another customer's while stopped in finalizing", async () => {
    const f = await aCycleInvoice();
    world.faults.set("finalize:before", 1);
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    fakeInvoice(f.invoiceId).customer = "cus_other";
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "finalized",
      usageGaps: ["identity_mismatch:customer"],
    });
    expect(world.calls.finalizeEffects).toBe(0);
    expect(fakeInvoice(f.invoiceId).status).toBe("draft");
  });

  it("keeps foreign items untouched and outside the fingerprint", async () => {
    const f = await aCycleInvoice();
    world.items.push({
      id: "ii_foreign",
      invoice: f.invoiceId,
      amount: 999,
      currency: "eur",
      period: { start: 0, end: 0 },
      metadata: {},
    });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    expect((await task(f.invoiceId))?.state).toBe("finalized");
    expect(world.items.find((i) => i.id === "ii_foreign")).toMatchObject({
      amount: 999,
      metadata: {},
    });
    expect((await task(f.invoiceId))?.fingerprint).not.toContain("999");
  });

  it("waits for not-ready usage until the deadline, then finalizes with the lines available and reports the gap", async () => {
    const f = await aCycleInvoice();
    setProviders(["cloud", "storage"]);
    world.otherResolve = () => [
      { key: "volume-gb-hours", description: "Volume", amountCents: 7 },
    ];
    world.resolve = () => ({ status: "not_ready", reason: "coverage" });
    await dispatchStripeWebhookEvent(invoiceCreated(f));
    await runRecovery(3);
    expect(await task(f.invoiceId)).toMatchObject({
      state: "suspended",
      lastError: "provider_not_ready:cloud:coverage",
    });
    expect(world.calls).toMatchObject({
      itemCreates: 0,
      finalizeEffects: 0,
    });

    passTheDeadline();
    await runRecovery();
    expect(await task(f.invoiceId)).toMatchObject({
      state: "finalized",
      usageGaps: ["provider_not_ready:cloud:coverage"],
    });
    expect(managedKeys(f.invoiceId)).toEqual(["storage:volume-gb-hours=7"]);
    expect(fakeInvoice(f.invoiceId).status).toBe("open");
    expect(world.gaps.map((entry) => entry.provider)).toEqual([
      "cloud",
      "storage",
    ]);
  });

  it.each([
    ["undefined", undefined],
    ["ready without lines", { status: "ready" }],
    ["unknown status", { status: "blocked", reason: "gone" }],
  ])(
    "treats a malformed resolution (%s) as not ready, never as an empty bill",
    async (_label, answer) => {
      const f = await aCycleInvoice();
      world.resolve = () => fromAny(answer);
      await dispatchStripeWebhookEvent(invoiceCreated(f));
      await runRecovery(3);
      expect(await task(f.invoiceId)).toMatchObject({
        state: "suspended",
        lastError: "provider_not_ready:cloud:invalid_resolution",
      });
      expect(world.calls).toMatchObject({
        itemCreates: 0,
        finalizeEffects: 0,
      });
    },
  );
});
