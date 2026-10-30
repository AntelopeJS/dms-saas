import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { fromPartial } from "@total-typescript/shoehorn";
import type Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import {
  insertFreeSubscription,
  type PlanChangeRequest,
} from "../src/routes/tenant/tenant-plan-ops";
import { startPaidCheckout } from "../src/routes/tenant/tenant-plan-checkout";
import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
} from "../src/stripe/webhook-checkout";
import { requestWorkspaceDeletion } from "../src/workspaces/deletion";
import { scheduleDeferredPlanChange } from "../src/plan-changes/deferred";
import { useMongoDatabase } from "./helpers/mongo";
import { allowCheckoutRedirects } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("subscription-effect-admission");
const stripe = useSuiteStripe();

const createdSessions = new Map<string, object>();
const CONTENDERS = 12;

beforeAll(allowCheckoutRedirects);

function stubStripe() {
  vi.spyOn(stripe.write.prices, "retrieve").mockResolvedValue(
    fromPartial({
      id: "price",
      recurring: { interval: "month", interval_count: 1 },
    }),
  );
  return {
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: "customer" })),
    updateCustomer: vi
      .spyOn(stripe.write.customers, "update")
      .mockResolvedValue(fromPartial({ id: "customer" })),
    createSession: vi
      .spyOn(stripe.write.checkout.sessions, "create")
      .mockImplementation(async (params) => {
        const session = {
          id: randomUUID(),
          url: "https://checkout.example.test/session",
          metadata: Object.fromEntries(
            Object.entries(params?.metadata ?? {}).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
        };
        createdSessions.set(session.id, session);
        return fromPartial(session);
      }),
    retrieveSession: vi
      .spyOn(stripe.write.checkout.sessions, "retrieve")
      .mockImplementation(async (id: string) =>
        fromPartial({ ...createdSessions.get(id), status: "open" }),
      ),
    retrieveSubscription: vi
      .spyOn(stripe.write.subscriptions, "retrieve")
      .mockResolvedValue(
        fromPartial({
          id: "paid-subscription",
          customer: "customer",
          default_payment_method: "payment-method",
          status: "active",
          items: { data: [{ current_period_end: 1_900_000_000 }] },
        }),
      ),
    cancelSubscription: vi.spyOn(stripe.write.subscriptions, "cancel"),
    createSchedule: vi.spyOn(stripe.write.subscriptionSchedules, "create"),
    releaseSchedule: vi.spyOn(stripe.write.subscriptionSchedules, "release"),
  };
}

let api: ReturnType<typeof stubStripe>;

beforeEach(() => {
  api = stubStripe();
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
    isComplimentary: true,
    paidUsagePeriods: [],
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

/**
 * The workspace's pending checkout session as Stripe reports it once it is
 * `status`, under the stored session id.
 */
async function pendingSession(
  request: PlanChangeRequest,
  status: "complete" | "expired",
) {
  const current = await request.tenantSubscriptionModel.findOne();
  if (!current?.stripeCheckoutSessionId) {
    throw new Error("The workspace has no checkout in flight");
  }
  return {
    id: current.stripeCheckoutSessionId,
    mode: "subscription" as const,
    status,
    subscription: "paid-subscription",
    metadata: {
      tenantId: request.tenantId,
      planId: "target",
      operationId: current.domainTransition?.operationId,
    },
  };
}

async function completedSessionEvent(
  request: PlanChangeRequest,
): Promise<Stripe.CheckoutSessionCompletedEvent> {
  return fromPartial<Stripe.CheckoutSessionCompletedEvent>({
    id: randomUUID(),
    type: "checkout.session.completed",
    data: { object: await pendingSession(request, "complete") },
  });
}

async function expiredSessionEvent(
  request: PlanChangeRequest,
): Promise<Stripe.CheckoutSessionExpiredEvent> {
  return fromPartial<Stripe.CheckoutSessionExpiredEvent>({
    id: randomUUID(),
    type: "checkout.session.expired",
    data: { object: await pendingSession(request, "expired") },
  });
}

describe("subscription effect admission with real Mongo mutations", () => {
  it("does not activate coverage for incomplete payment and allows a later successful retry", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await completedSessionEvent(request);
    api.retrieveSubscription.mockResolvedValueOnce(
      fromPartial({ status: "incomplete" }),
    );
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

  it("fences an expiration observed before a competing completion admission", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const expired = await expiredSessionEvent(request);
    const completed = await completedSessionEvent(request);
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
    await handleCheckoutSessionExpired(await expiredSessionEvent(request));
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription?.domainTransition).toBeNull();
    expect(subscription?.stripeCheckoutSessionId).toBeNull();
    await startPaidCheckout({ ...request, subscription });
    expect(
      api.createSession.mock.calls[1][0]?.subscription_data?.trial_period_days,
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
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(
      api.createSession.mock.calls[0][0]?.subscription_data?.trial_period_days,
    ).toBe(7);
    expect(api.createSession.mock.calls[0][0]).toMatchObject({
      managed_payments: { enabled: false },
      subscription_data: { billing_mode: { type: "classic" } },
    });
    const current = await request.tenantSubscriptionModel.findOne();
    expect(current?.domainTransition?.kind).toBe("checkout");
    const otherTenant = await checkoutRequest(request.user.email);
    await startPaidCheckout(otherTenant);
    expect(
      api.createSession.mock.calls[1][0]?.subscription_data?.trial_period_days,
    ).toBeUndefined();
    await expect(
      startPaidCheckout({ ...request, subscription: current }),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_in_progress",
    });
    expect(api.createSession).toHaveBeenCalledTimes(2);
  });

  it("holds checkout completion admission through the last provider effect and receipts replay", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await completedSessionEvent(request);
    let release = () => {};
    let entered = () => {};
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    api.updateCustomer.mockImplementationOnce(async () => {
      entered();
      await paused;
      return fromPartial({});
    });
    const first = handleCheckoutSessionCompleted(event);
    await ready;
    await expect(handleCheckoutSessionCompleted(event)).rejects.toThrow(
      "requires reconciliation",
    );
    await handleCheckoutSessionExpired(await expiredSessionEvent(request));
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
    expect(api.updateCustomer).toHaveBeenCalledTimes(1);
    expect(api.retrieveSubscription).toHaveBeenCalledTimes(1);
  });

  it("retains an unknown completion admission and does not guess a retry", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const event = await completedSessionEvent(request);
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
    expect(api.retrieveSubscription).not.toHaveBeenCalled();
    expect(
      (await request.tenantSubscriptionModel.findOne())?.domainTransition?.kind,
    ).toBe("change_plan");
  });

  it("retains cancellation intent when Stripe acknowledgement is lost", async () => {
    const request = await checkoutRequest();
    await request.tenantSubscriptionModel.update(request.tenantId, {
      stripeSubscriptionId: "paid",
    });
    api.cancelSubscription.mockRejectedValueOnce(new Error("ack unknown"));
    await expect(
      requestWorkspaceDeletion(request.tenantId, "owner"),
    ).rejects.toThrow("ack unknown");
    expect(await request.tenantSubscriptionModel.findOne()).toMatchObject({
      status: "active",
      domainTransition: { kind: "cancel" },
    });
    await expect(
      requestWorkspaceDeletion(request.tenantId, "owner"),
    ).rejects.toThrow("different pending transition");
    expect(api.cancelSubscription).toHaveBeenCalledTimes(1);
  });

  it("does not compensate an ambiguous replacement schedule", async () => {
    const request = await checkoutRequest();
    await request.tenantSubscriptionModel.update(request.tenantId, {
      stripeSubscriptionId: "paid",
      pendingPlanId: "old-target",
    });
    const subscription = await request.tenantSubscriptionModel.findOne();
    if (!subscription) throw new Error("Missing fixture");
    api.retrieveSubscription.mockResolvedValueOnce(
      fromPartial({ schedule: "old-schedule", cancel_at_period_end: false }),
    );
    api.releaseSchedule.mockResolvedValueOnce(fromPartial({}));
    api.createSchedule.mockRejectedValueOnce(
      new Error("schedule acknowledgement unknown"),
    );
    await expect(
      scheduleDeferredPlanChange({
        tenantId: request.tenantId,
        subscription,
        targetPlan: request.newPlan,
      }),
    ).rejects.toThrow("acknowledgement unknown");
    expect(api.releaseSchedule).toHaveBeenCalledTimes(1);
    expect(api.createSchedule).toHaveBeenCalledTimes(1);
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

  it("writes a revision and an empty coverage ledger on a free grant", async () => {
    const tenantId = randomUUID();
    const model = GetModel(TenantSubscriptionModel, tenantId);
    const user = Object.assign(new User(), { _id: randomUUID() });
    await insertFreeSubscription(user, "free", tenantId, model);
    const inserted = await model.findOne();
    expect(inserted?.paidUsagePeriods).toEqual([]);
    expect(inserted?.revision).toBeTypeOf("string");
  });

  it("opens coverage only when the first checkout of a plan-less workspace completes", async () => {
    const request = { ...(await checkoutRequest()), subscription: undefined };
    await request.tenantSubscriptionModel.table.delete().run();
    await startPaidCheckout(request);
    const placeholder = await request.tenantSubscriptionModel.findOne();
    expect(placeholder).toMatchObject({
      status: "pending_payment",
      paidUsagePeriods: [],
    });
    expect(placeholder?.revision).toBeTypeOf("string");
    await handleCheckoutSessionCompleted(await completedSessionEvent(request));
    expect(
      (await request.tenantSubscriptionModel.findOne())?.paidUsagePeriods,
    ).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: "paid-subscription",
        end: null,
      }),
    ]);
  });
});
