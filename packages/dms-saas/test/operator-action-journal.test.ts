import { randomUUID } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { grantBalanceCreditCommand } from "../src/operator-actions/commands";
import { OperatorActionModel } from "../src/operator-actions/db/operator-action.model";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("operator-action-journal");
const stripe = useSuiteStripe();
const logs = captureLogs();

const BASE_TIME = new Date("2026-08-28T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const SAFE_RETRY_WINDOW_MS = 23 * HOUR_MS;

/** What the stand-in Stripe account was asked and what it did. */
const ledger = {
  attempts: new Array<string>(),
  journalStatusesSeen: new Array<string | undefined>(),
  transactions: new Map<string, { id: string; amount: number }>(),
  failDefinitivelyOnce: false,
};

let input: Parameters<typeof grantBalanceCreditCommand>[0];

function journal() {
  return GetModel(OperatorActionModel).get(input.operationId);
}

/**
 * Stripe's balance transactions with its idempotency contract: a key already
 * seen returns the transaction the first request created. Each call also
 * records the status the operator journal held when Stripe was reached.
 */
function installStripeBalance(): void {
  vi.spyOn(
    stripe.write.customers,
    "createBalanceTransaction",
  ).mockImplementation(async (_customerId, params, options) => {
    const key = options?.idempotencyKey ?? "";
    ledger.attempts.push(key);
    ledger.journalStatusesSeen.push((await journal())?.status);
    if (ledger.failDefinitivelyOnce) {
      ledger.failDefinitivelyOnce = false;
      throw new HTTPResult(402, "saas.errors.operator.definitive_failure");
    }
    const existing = ledger.transactions.get(key);
    if (existing) return fromPartial(existing);
    const transaction = {
      id: "cbtxn_123",
      amount: params.amount,
      currency: params.currency,
      ending_balance: params.amount,
      created: 1_700_000_000,
    };
    ledger.transactions.set(key, transaction);
    return fromPartial(transaction);
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BASE_TIME);
  ledger.attempts.length = 0;
  ledger.journalStatusesSeen.length = 0;
  ledger.transactions.clear();
  ledger.failDefinitivelyOnce = false;
  installStripeBalance();
  const tenantId = randomUUID();
  const planId = randomUUID();
  await GetModel(PlanModel).insert(planRow({ _id: planId, currency: "EUR" }));
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId,
    status: "active",
    stripeCustomerId: "cus_123",
  });
  input = {
    tenantId,
    operationId: `credit-operation-${randomUUID()}`,
    actor: { id: "owner-123", email: "owner@example.com" },
    amountCents: 2500,
    reason: "Service recovery credit",
  };
});

afterEach(() => {
  vi.useRealTimers();
});

async function createDefinitiveFailedCredit(): Promise<void> {
  ledger.failDefinitivelyOnce = true;
  await expect(grantBalanceCreditCommand(input)).rejects.toMatchObject({
    status: 402,
    body: "saas.errors.operator.definitive_failure",
  });
  expect(await journal()).toMatchObject({ status: "failed", attemptCount: 1 });
}

describe("durable operator journal", () => {
  it("retries a definitive failure inside the safe window with the same Stripe key", async () => {
    await createDefinitiveFailedCredit();
    expect(ledger.journalStatusesSeen).toEqual(["running"]);
    expect(await journal()).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "saas.errors.operator.definitive_failure",
    });

    await expect(
      grantBalanceCreditCommand({ ...input, amountCents: 2600 }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.idempotency_mismatch",
    });
    expect(ledger.attempts).toHaveLength(1);

    vi.setSystemTime(BASE_TIME.getTime() + SAFE_RETRY_WINDOW_MS - HOUR_MS);
    await expect(grantBalanceCreditCommand(input)).resolves.toMatchObject({
      operationId: input.operationId,
      status: "succeeded",
    });
    expect(await journal()).toMatchObject({
      attemptCount: 2,
      details: {
        amountCents: 2500,
        reason: "Service recovery credit",
        stripeTransactionId: "cbtxn_123",
      },
    });
    expect(ledger.attempts).toEqual([
      `saas-operator-credit:${input.operationId}`,
      `saas-operator-credit:${input.operationId}`,
    ]);
    expect(ledger.transactions.size).toBe(1);
  });

  it("requires reconciliation instead of retrying after the safe window", async () => {
    await createDefinitiveFailedCredit();
    vi.setSystemTime(BASE_TIME.getTime() + SAFE_RETRY_WINDOW_MS + 1);
    ledger.transactions.clear();

    await expect(grantBalanceCreditCommand(input)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.reconciliation_required",
    });
    expect(await journal()).toMatchObject({
      status: "reconciliation_required",
      attemptCount: 1,
      lastErrorCode: "saas.errors.operator.reconciliation_required",
    });
    expect(ledger.attempts).toHaveLength(1);
    expect(ledger.transactions.size).toBe(0);

    await expect(
      grantBalanceCreditCommand({ ...input, amountCents: 2600 }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.idempotency_mismatch",
    });
    expect(ledger.attempts).toHaveLength(1);
  });

  it("does not replay after an effect succeeded but its journal acknowledgement was lost", async () => {
    vi.spyOn(
      GetModel(OperatorActionModel),
      "markSucceeded",
    ).mockRejectedValueOnce(new Error("journal success write failed"));

    await expect(grantBalanceCreditCommand(input)).rejects.toBeInstanceOf(
      HTTPResult,
    );
    expect((await journal())?.status).toBe("reconciliation_required");
    expect(logs.at("ERROR")).toEqual([
      [
        `[dms-saas:operator] operation ${input.operationId} failed`,
        expect.objectContaining({ message: "journal success write failed" }),
      ],
    ]);
    await expect(grantBalanceCreditCommand(input)).rejects.toMatchObject({
      status: 409,
    });
    expect(ledger.transactions.size).toBe(1);
    expect(ledger.attempts).toHaveLength(1);
  });
});
