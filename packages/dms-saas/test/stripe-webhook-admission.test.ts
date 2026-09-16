import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type Stripe from "stripe";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db/models/stripeWebhookEvents.model";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";

const handlers = vi.hoisted(() => ({ created: vi.fn() }));
vi.mock("../src/stripe/webhook-credit-notes", () => ({
  handleCreditNoteCreated: handlers.created,
  handleCreditNoteVoided: vi.fn(),
}));

const SETUP_TIMEOUT_MS = 60_000;
const BEYOND_LEGACY_TIMEOUT_MS = 16 * 60 * 1000;
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "webhook-admission" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, SETUP_TIMEOUT_MS);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  handlers.created.mockReset();
});
afterAll(async () => {
  await destroy();
  await mongodb?.stop();
});

function event(): Stripe.Event {
  return { id: randomUUID(), type: "credit_note.created" } as Stripe.Event;
}

it("does not take over a paused handler beyond the old timeout", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  handlers.created.mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
  });
  const input = event();
  const first = dispatchStripeWebhookEvent(input);
  await started.promise;
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + BEYOND_LEGACY_TIMEOUT_MS);
    await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
      "reconciliation",
    );
    expect(handlers.created).toHaveBeenCalledOnce();
  } finally {
    finish.resolve();
    await first;
  }
  await dispatchStripeWebhookEvent(input);
  expect(handlers.created).toHaveBeenCalledOnce();
});

it("rejects stale completion even after the same attempt has already completed", async () => {
  const model = GetModel(StripeWebhookEventModel);
  const input = event();
  const revision = await model.tryClaim(input.id, input.type);
  expect(revision).toBeTypeOf("string");
  await model.markResult(input.id, revision!, "success", null);
  await expect(
    model.markResult(
      input.id,
      revision!,
      "reconciliation_required",
      "late error",
    ),
  ).rejects.toThrow("not-applied");
  expect((await model.get(input.id))?.result).toBe("success");
});

it("preserves an admitted insert whose acknowledgement was lost", async () => {
  const model = GetModel(StripeWebhookEventModel);
  const insert = model.insert.bind(model);
  vi.spyOn(model, "insert").mockImplementationOnce(async (...args) => {
    await insert(...args);
    throw new Error("insert acknowledgement lost");
  });
  const input = event();
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "acknowledgement lost",
  );
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "reconciliation",
  );
  expect(handlers.created).not.toHaveBeenCalled();
  expect((await model.get(input.id))?.result).toBe("pending");
});

it.each([true, false])(
  "does not overwrite or replay unknown completion (applied=%s)",
  async (isApplied) => {
    const model = GetModel(StripeWebhookEventModel);
    const atomicMutation = model.table.atomicMutation.bind(model.table);
    const writes = vi
      .spyOn(model.table, "atomicMutation")
      .mockImplementationOnce((key, request) => {
        const query = atomicMutation(key, request);
        return {
          run: async () => {
            if (isApplied) await query.run();
            return "unknown";
          },
        } as typeof query;
      });
    const input = event();
    await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow("unknown");
    expect(writes).toHaveBeenCalledOnce();
    expect((await model.get(input.id))?.result).toBe(
      isApplied ? "success" : "pending",
    );
    if (isApplied) await dispatchStripeWebhookEvent(input);
    else
      await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
        "reconciliation",
      );
    expect(handlers.created).toHaveBeenCalledOnce();
  },
);

it("keeps partial failures and legacy failed attempts out of replay and retention", async () => {
  const model = GetModel(StripeWebhookEventModel);
  const input = event();
  handlers.created.mockRejectedValueOnce(new Error("effect outcome unknown"));
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "effect outcome unknown",
  );
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "reconciliation",
  );
  const legacy = event();
  await model.insert({
    _id: legacy.id,
    type: legacy.type,
    result: "failed",
    processedAt: new Date(0),
  });
  await expect(model.tryClaim(legacy.id, legacy.type)).rejects.toThrow(
    "reconciliation",
  );
  await model.deleteProcessedBefore(
    new Date(Date.now() + BEYOND_LEGACY_TIMEOUT_MS),
  );
  expect((await model.get(input.id))?.result).toBe("reconciliation_required");
  expect((await model.get(legacy.id))?.result).toBe("failed");
  expect(handlers.created).toHaveBeenCalledOnce();
});
