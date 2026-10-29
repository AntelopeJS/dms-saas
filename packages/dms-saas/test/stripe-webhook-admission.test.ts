import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StripeWebhookEventModel } from "@antelopejs/interface-dms-saas/db/models/stripeWebhookEvents.model";
import { dispatchStripeWebhookEvent } from "../src/stripe/webhook-dispatch";
import {
  type CreditedWorkspace,
  creditedWorkspace,
} from "./helpers/credit-notes";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("stripe-webhook-admission");
const stripe = useSuiteStripe();

const BEYOND_OLD_CLAIM_TIMEOUT_MS = 16 * 60 * 1000;

let workspace: CreditedWorkspace;

/** The `credit_note.created` handler's read of the credit note from Stripe. */
function stubCreditNoteRead() {
  return vi
    .spyOn(stripe.write.creditNotes, "retrieve")
    .mockResolvedValue(fromPartial(workspace.creditNote));
}

beforeEach(async () => {
  workspace = await creditedWorkspace();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function event() {
  return workspace.event;
}

it("does not take over a paused handler beyond the old timeout", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const retrieve = stubCreditNoteRead();
  retrieve.mockImplementationOnce(async () => {
    started.resolve();
    await finish.promise;
    return fromPartial(workspace.creditNote);
  });
  const input = event();
  const first = dispatchStripeWebhookEvent(input);
  await started.promise;
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + BEYOND_OLD_CLAIM_TIMEOUT_MS);
    await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
      "reconciliation",
    );
    expect(retrieve).toHaveBeenCalledOnce();
  } finally {
    finish.resolve();
    await first;
  }
  await dispatchStripeWebhookEvent(input);
  expect(retrieve).toHaveBeenCalledOnce();
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
  const retrieve = stubCreditNoteRead();
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "acknowledgement lost",
  );
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "reconciliation",
  );
  expect(retrieve).not.toHaveBeenCalled();
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
    const retrieve = stubCreditNoteRead();
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
    expect(retrieve).toHaveBeenCalledOnce();
  },
);

it("keeps partial failures out of replay and retention", async () => {
  const model = GetModel(StripeWebhookEventModel);
  const input = event();
  stubCreditNoteRead().mockRejectedValueOnce(
    new Error("effect outcome unknown"),
  );
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "effect outcome unknown",
  );
  await expect(dispatchStripeWebhookEvent(input)).rejects.toThrow(
    "reconciliation",
  );
  await model.deleteProcessedBefore(
    new Date(Date.now() + BEYOND_OLD_CLAIM_TIMEOUT_MS),
  );
  expect((await model.get(input.id))?.result).toBe("reconciliation_required");
  expect(stripe.write.creditNotes.retrieve).toHaveBeenCalledOnce();
});
