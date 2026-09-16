import { HTTPResult } from "@antelopejs/interface-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface JournalAction {
  _id: string;
  tenantId: string;
  actorId: string;
  actorEmail: string;
  action: string;
  status:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "reconciliation_required";
  requestFingerprint: string;
  details: Record<string, unknown>;
  attemptCount: number;
  revision: string;
  lastErrorCode: string | null;
  effectiveAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

interface CreditPayload {
  amount: number;
  currency: string;
  description: string;
}

interface StripeRequestOptions {
  idempotencyKey: string;
}

interface StripeTransaction {
  id: string;
  amount: number;
  currency: string;
  ending_balance: number;
  created: number;
}

interface ActionOutcome {
  details: Record<string, unknown>;
  effectiveAt: Date;
}

interface NamedModel {
  name: string;
}

const harness = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
  events: [] as string[],
  stripeAttempts: [] as string[],
  stripeTransactions: new Map<string, unknown>(),
  stripeEffects: 0,
  failFirstSuccessWrite: true,
  failDefinitivelyOnce: false,
}));

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...original,
    GetModel: (model: NamedModel): unknown => harness.models.get(model.name),
  };
});

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn() },
}));

vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => stripeClient(),
}));

import { grantBalanceCreditCommand } from "../src/operator-actions/commands";

let action: JournalAction | undefined;

const BASE_TIME = new Date("2026-08-28T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const SAFE_RETRY_WINDOW_MS = 23 * HOUR_MS;

function markReconciliationRequired(errorCode: string): void {
  if (!action) return;
  action.status = "reconciliation_required";
  action.lastErrorCode = errorCode;
  action.completedAt = new Date();
}

function operatorActionModel(): object {
  return {
    insert: async (intent: JournalAction) => {
      if (action) throw new Error("duplicate operation");
      harness.events.push("intent");
      action = { ...intent };
    },
    get: async () => action,
    updateDetails: async (
      current: JournalAction,
      details: Record<string, unknown>,
    ) => {
      current.details = details;
      return current;
    },
    beginAttempt: async (_current: JournalAction) => {
      if (!action || !["pending", "failed"].includes(action.status))
        throw new Error("not eligible");
      action.status = "running";
      action.attemptCount += 1;
      action.startedAt = new Date();
      return action;
    },
    markSucceeded: async (_current: JournalAction, outcome: ActionOutcome) => {
      if (harness.failFirstSuccessWrite) {
        harness.failFirstSuccessWrite = false;
        throw new Error("journal success write failed");
      }
      if (!action) return;
      action.status = "succeeded";
      action.details = outcome.details;
      action.effectiveAt = outcome.effectiveAt;
      action.completedAt = new Date();
    },
    markFailed: async (_current: JournalAction, errorCode: string) => {
      if (!action) return;
      action.status = "failed";
      action.lastErrorCode = errorCode;
      action.completedAt = new Date();
    },
    markReconciliationRequired: async (
      _current: JournalAction,
      errorCode: string,
    ) => {
      markReconciliationRequired(errorCode);
    },
  };
}

function stripeClient(): object {
  return {
    customers: {
      createBalanceTransaction: async (
        _customerId: string,
        payload: CreditPayload,
        options: StripeRequestOptions,
      ) => createStripeTransaction(payload, options.idempotencyKey),
    },
  };
}

function createStripeTransaction(
  payload: CreditPayload,
  idempotencyKey: string,
): StripeTransaction {
  harness.events.push("stripe");
  harness.stripeAttempts.push(idempotencyKey);
  if (harness.failDefinitivelyOnce) {
    harness.failDefinitivelyOnce = false;
    throw new HTTPResult(402, "saas.errors.operator.definitive_failure");
  }
  const existing = harness.stripeTransactions.get(idempotencyKey);
  if (existing) return existing as StripeTransaction;
  harness.stripeEffects += 1;
  const transaction: StripeTransaction = {
    id: "cbtxn_123",
    amount: payload.amount,
    currency: payload.currency,
    ending_balance: payload.amount,
    created: 1_700_000_000,
  };
  harness.stripeTransactions.set(idempotencyKey, transaction);
  return transaction;
}

function configureModels(): void {
  harness.models.set("OperatorActionModel", operatorActionModel());
  harness.models.set("TenantSubscriptionModel", {
    findOne: async () => ({
      planId: "paid-plan",
      stripeCustomerId: "cus_123",
    }),
  });
  harness.models.set("PlanModel", {
    get: async () => ({ currency: "EUR" }),
  });
}

const input = {
  tenantId: "tenant-123",
  operationId: "credit-operation-123",
  actor: { id: "owner-123", email: "owner@example.com" },
  amountCents: 2500,
  reason: "Service recovery credit",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_TIME);
  action = undefined;
  harness.models.clear();
  harness.events.length = 0;
  harness.stripeAttempts.length = 0;
  harness.stripeTransactions.clear();
  harness.stripeEffects = 0;
  harness.failFirstSuccessWrite = true;
  harness.failDefinitivelyOnce = false;
  configureModels();
});

afterEach(() => {
  vi.useRealTimers();
});

async function createDefinitiveFailedCredit(): Promise<void> {
  harness.failFirstSuccessWrite = false;
  harness.failDefinitivelyOnce = true;
  const error = await grantBalanceCreditCommand(input).catch(
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({
    status: 402,
    body: "saas.errors.operator.definitive_failure",
  });
  expect(action).toMatchObject({ status: "failed", attemptCount: 1 });
}

describe("durable operator journal", () => {
  it("retries a definitive failure inside the safe window with the same Stripe key", async () => {
    await createDefinitiveFailedCredit();
    expect(harness.events.slice(0, 2)).toEqual(["intent", "stripe"]);
    expect(action).toMatchObject({
      status: "failed",
      attemptCount: 1,
      lastErrorCode: "saas.errors.operator.definitive_failure",
    });

    const mismatch = await grantBalanceCreditCommand({
      ...input,
      amountCents: 2600,
    }).catch((error: unknown) => error);
    expect(mismatch).toMatchObject({
      status: 409,
      body: "saas.errors.operator.idempotency_mismatch",
    });
    expect(harness.stripeAttempts).toHaveLength(1);

    vi.setSystemTime(BASE_TIME.getTime() + SAFE_RETRY_WINDOW_MS - HOUR_MS);
    await expect(grantBalanceCreditCommand(input)).resolves.toMatchObject({
      operationId: input.operationId,
      status: "succeeded",
    });
    expect(action).toMatchObject({
      attemptCount: 2,
      details: {
        amountCents: 2500,
        reason: "Service recovery credit",
        stripeTransactionId: "cbtxn_123",
      },
    });
    expect(harness.stripeAttempts).toEqual([
      "saas-operator-credit:credit-operation-123",
      "saas-operator-credit:credit-operation-123",
    ]);
    expect(harness.stripeEffects).toBe(1);
  });

  it("requires reconciliation instead of retrying after the safe window", async () => {
    await createDefinitiveFailedCredit();
    vi.setSystemTime(BASE_TIME.getTime() + SAFE_RETRY_WINDOW_MS + 1);
    harness.stripeTransactions.clear();

    await expect(grantBalanceCreditCommand(input)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.reconciliation_required",
    });
    expect(action).toMatchObject({
      status: "reconciliation_required",
      attemptCount: 1,
      lastErrorCode: "saas.errors.operator.reconciliation_required",
    });
    expect(harness.stripeAttempts).toHaveLength(1);
    expect(harness.stripeEffects).toBe(0);

    await expect(
      grantBalanceCreditCommand({ ...input, amountCents: 2600 }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.operator.idempotency_mismatch",
    });
    expect(harness.stripeAttempts).toHaveLength(1);
  });

  it("does not replay after an effect succeeded but its journal acknowledgement was lost", async () => {
    await expect(grantBalanceCreditCommand(input)).rejects.toBeInstanceOf(
      HTTPResult,
    );
    expect(action?.status).toBe("reconciliation_required");
    await expect(grantBalanceCreditCommand(input)).rejects.toMatchObject({
      status: 409,
    });
    expect(harness.stripeEffects).toBe(1);
    expect(harness.stripeAttempts).toHaveLength(1);
  });
});
