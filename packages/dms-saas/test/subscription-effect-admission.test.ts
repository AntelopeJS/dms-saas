import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import {
  startPaidCheckout,
  insertFreeSubscription,
  type PlanChangeRequest,
} from "../src/routes/tenant/tenant-plan-ops";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
} from "../src/stripe/webhook-checkout";
import { requestWorkspaceDeletion } from "../src/workspaces/deletion";
import { scheduleDeferredPlanChange } from "../src/plan-changes/deferred";

const stripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), cancel: vi.fn(), update: vi.fn() },
  customers: { create: vi.fn(), update: vi.fn() },
  checkout: { sessions: { create: vi.fn(), expire: vi.fn() } },
  subscriptionSchedules: { create: vi.fn(), release: vi.fn() },
}));
vi.mock("../src/stripe/client", () => ({ getStripeClient: () => stripe }));
vi.mock("../src/config", () => ({ isAllowedRedirectUrl: () => true }));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/automation", () => ({ emitAutomationEvent: () => undefined }));
vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

const SETUP_TIMEOUT_MS = 60_000;
const CONTENDERS = 12;
let mongodb: MongoMemoryReplSet;
beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "saas-effect-admission" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
}, SETUP_TIMEOUT_MS);
afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.clearAllMocks();
  stripe.customers.create.mockResolvedValue({ id: "customer" });
  stripe.customers.update.mockResolvedValue({ id: "customer" });
  stripe.checkout.sessions.create.mockImplementation(
    async (params: Stripe.Checkout.SessionCreateParams) => ({
      id: randomUUID(),
      url: "https://checkout.example.test/session",
      metadata: params.metadata,
    }),
  );
  stripe.subscriptions.retrieve.mockResolvedValue({
    id: "paid-subscription",
    customer: "customer",
    default_payment_method: "payment-method",
    status: "active",
    current_period_end: 1_900_000_000,
  });
});

async function checkoutRequest(
  email = `${randomUUID()}@example.test`,
): Promise<PlanChangeRequest> {
  const tenantId = randomUUID();
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const [id] = await tenantSubscriptionModel.insert({
    _id: tenantId,
    planId: "source",
    status: "active",
  });
  return {
    tenantId,
    tenantSubscriptionModel,
    subscription: await tenantSubscriptionModel.get(id),
    user: Object.assign(new User(), { _id: randomUUID(), email }),
    newPlan: PlanModel.fromPlainData({
      _id: "target",
      trialDays: 7,
      paymentProviderRefs: { stripePriceId: "price-target" },
    }),
    body: {
      planId: "target",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
}

async function sessionEvent(
  request: PlanChangeRequest,
  expired = false,
): Promise<Stripe.Event> {
  const current = await request.tenantSubscriptionModel.findOne();
  return {
    id: randomUUID(),
    type: expired ? "checkout.session.expired" : "checkout.session.completed",
    data: {
      object: {
        id: current?.stripeCheckoutSessionId,
        mode: "subscription",
        status: expired ? "expired" : "complete",
        subscription: "paid-subscription",
        metadata: {
          tenantId: request.tenantId,
          planId: "target",
          operationId: current?.domainTransition?.operationId,
        },
      },
    },
  } as Stripe.Event;
}

describe("subscription effect admission with real Mongo mutations", () => {
  it("does not activate coverage for incomplete payment and allows a later successful retry", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await sessionEvent(request);
    stripe.subscriptions.retrieve.mockResolvedValueOnce({
      status: "incomplete",
    });
    await expect(handleCheckoutSessionCompleted(event)).rejects.toThrow(
      "has not activated",
    );
    expect(await request.tenantSubscriptionModel.findOne()).toMatchObject({
      isComplimentary: true,
      paidUsagePeriods: [],
      domainTransition: { kind: "checkout" },
    });
    await handleCheckoutSessionCompleted(event);
    const completed = await request.tenantSubscriptionModel.findOne();
    expect(completed?.isComplimentary).toBe(false);
    expect(completed?.paidUsagePeriods).toHaveLength(1);
  });

  it("keeps legacy complimentary history waived while checkout is pending or expires", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const pending = await request.tenantSubscriptionModel.findOne();
    expect(pending).toMatchObject({
      stripeCustomerId: "customer",
      isComplimentary: true,
      paidUsagePeriods: [],
    });
    await handleCheckoutSessionExpired(await sessionEvent(request, true));
    const expired = await request.tenantSubscriptionModel.findOne();
    expect(expired).toMatchObject({
      isComplimentary: true,
      paidUsagePeriods: [],
    });
    expect(expired?.stripeSubscriptionId).toBeFalsy();
  });

  it("fences an expiration observed before a competing completion admission", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const expired = await sessionEvent(request, true);
    const completed = await sessionEvent(request);
    const model = request.tenantSubscriptionModel;
    const read = model.findOne.bind(model);
    let release = () => {};
    let entered = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(model, "findOne").mockImplementationOnce(async () => {
      const old = await read();
      entered();
      await paused;
      return old;
    });
    const expiration = handleCheckoutSessionExpired(expired);
    const rejected = expect(expiration).rejects.toThrow("not-applied");
    await ready;
    await handleCheckoutSessionCompleted(completed);
    release();
    await rejected;
    expect(await read()).toMatchObject({
      completedCheckoutSessionId: expired.data.object.id,
      stripeCheckoutSessionId: expired.data.object.id,
      domainTransition: null,
    });
  });

  it("allows another checkout after recorded expiry without granting another trial", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    await handleCheckoutSessionExpired(await sessionEvent(request, true));
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription?.domainTransition).toBeNull();
    expect(subscription?.stripeCheckoutSessionId).toBeNull();
    await startPaidCheckout({ ...request, subscription });
    expect(
      stripe.checkout.sessions.create.mock.calls[1][0].subscription_data
        .trial_period_days,
    ).toBeUndefined();
  });

  it("admits one checkout and reserves the trial across tenants before payment", async () => {
    const request = await checkoutRequest();
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () => startPaidCheckout(request)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(
      stripe.checkout.sessions.create.mock.calls[0][0].subscription_data
        .trial_period_days,
    ).toBe(7);
    const current = await request.tenantSubscriptionModel.findOne();
    expect(current?.domainTransition?.kind).toBe("checkout");
    const otherTenant = await checkoutRequest(request.user.email);
    await startPaidCheckout(otherTenant);
    expect(
      stripe.checkout.sessions.create.mock.calls[1][0].subscription_data
        .trial_period_days,
    ).toBeUndefined();
    await expect(
      startPaidCheckout({ ...request, subscription: current }),
    ).rejects.toThrow("different pending transition");
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });

  it("holds checkout completion admission through the last provider effect and receipts replay", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await sessionEvent(request);
    let release = () => {};
    let entered = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    stripe.customers.update.mockImplementationOnce(async () => {
      entered();
      await paused;
      return {};
    });
    const first = handleCheckoutSessionCompleted(event);
    await ready;
    await expect(handleCheckoutSessionCompleted(event)).rejects.toThrow(
      "requires reconciliation",
    );
    await handleCheckoutSessionExpired(await sessionEvent(request, true));
    expect(
      (await request.tenantSubscriptionModel.findOne())?.domainTransition?.kind,
    ).toBe("change_plan");
    release();
    await first;
    const completed = await request.tenantSubscriptionModel.findOne();
    expect(completed?.domainTransition).toBeNull();
    expect(completed?.completedCheckoutSessionId).toBe(
      completed?.stripeCheckoutSessionId,
    );
    await handleCheckoutSessionCompleted(event);
    expect(stripe.customers.update).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
  });

  it("retains an unknown completion admission and does not guess a retry", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await sessionEvent(request);
    const mutate = request.tenantSubscriptionModel.mutateRevision.bind(
      request.tenantSubscriptionModel,
    );
    vi.spyOn(
      request.tenantSubscriptionModel,
      "mutateRevision",
    ).mockImplementationOnce(async (...args) => {
      await mutate(...args);
      return "unknown";
    });
    await expect(handleCheckoutSessionCompleted(event)).rejects.toThrow(
      "unknown",
    );
    await expect(handleCheckoutSessionCompleted(event)).rejects.toThrow(
      "requires reconciliation",
    );
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(
      (await request.tenantSubscriptionModel.findOne())?.domainTransition?.kind,
    ).toBe("change_plan");
  });

  it("retains cancellation intent when Stripe acknowledgement is lost", async () => {
    const request = await checkoutRequest();
    await request.tenantSubscriptionModel.update(request.tenantId, {
      stripeSubscriptionId: "paid",
    });
    stripe.subscriptions.cancel.mockRejectedValueOnce(new Error("ack unknown"));
    await expect(requestWorkspaceDeletion(request.tenantId)).rejects.toThrow(
      "ack unknown",
    );
    expect(await request.tenantSubscriptionModel.findOne()).toMatchObject({
      status: "active",
      domainTransition: { kind: "cancel" },
    });
    await expect(requestWorkspaceDeletion(request.tenantId)).rejects.toThrow(
      "different pending transition",
    );
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("does not compensate an ambiguous replacement schedule", async () => {
    const request = await checkoutRequest();
    await request.tenantSubscriptionModel.update(request.tenantId, {
      stripeSubscriptionId: "paid",
      pendingPlanId: "old-target",
    });
    const subscription = await request.tenantSubscriptionModel.findOne();
    if (!subscription) throw new Error("Missing fixture");
    stripe.subscriptions.retrieve.mockResolvedValueOnce({
      schedule: "old-schedule",
      cancel_at_period_end: false,
    });
    stripe.subscriptionSchedules.release.mockResolvedValueOnce({});
    stripe.subscriptionSchedules.create.mockRejectedValueOnce(
      new Error("schedule acknowledgement unknown"),
    );
    await expect(
      scheduleDeferredPlanChange({
        tenantId: request.tenantId,
        subscription,
        targetPlan: request.newPlan,
      }),
    ).rejects.toThrow("acknowledgement unknown");
    expect(stripe.subscriptionSchedules.release).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptionSchedules.create).toHaveBeenCalledTimes(1);
    expect(await request.tenantSubscriptionModel.findOne()).toMatchObject({
      pendingPlanId: "old-target",
      domainTransition: { targetPlanId: "target" },
    });
  });

  it("uses a single initial subscription identity for concurrent free grants", async () => {
    const tenantId = randomUUID();
    const model = GetModel(TenantSubscriptionModel, tenantId);
    const user = Object.assign(new User(), { _id: randomUUID() });
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, () =>
        insertFreeSubscription(user, "free", tenantId, model),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(await model.table.count().run()).toBe(1);
    expect((await model.findOne())?._id).toBe(tenantId);
  });
});
