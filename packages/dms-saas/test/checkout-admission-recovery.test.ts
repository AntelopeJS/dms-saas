import { randomUUID } from "node:crypto";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import Stripe from "stripe";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PlanModel, TenantSubscriptionModel } from "../src/db";
import { startPaidCheckout } from "../src/routes/tenant/tenant-plan-checkout";
import {
  cancelPendingCheckout,
  describePendingCheckout,
  UNRECORDED_CHECKOUT_TTL_MS,
} from "../src/routes/tenant/tenant-plan-checkout-recovery";
import { handleCheckoutSessionExpired } from "../src/stripe/webhook-checkout";
import { CHECKOUT_SESSION_LIFETIME_MS } from "../src/stripe/workspace-checkout";
import type { PlanChangeRequest } from "../src/routes/tenant/tenant-plan-ops";
import { hashEmail } from "../src/utils";
import {
  TrialIdentityModel,
  trialIdentityId,
} from "../src/workspaces/db/trial-identity.model";

const stripe = vi.hoisted(() => ({
  customers: { create: vi.fn(), retrieve: vi.fn(), del: vi.fn() },
  checkout: {
    sessions: { create: vi.fn(), expire: vi.fn(), retrieve: vi.fn() },
  },
}));
vi.mock("../src/stripe/client", () => ({ getStripeClient: () => stripe }));
vi.mock("../src/config", () => ({ isAllowedRedirectUrl: () => true }));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn(), Warn: vi.fn(), Info: vi.fn() },
}));
vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

const SETUP_TIMEOUT_MS = 60_000;
const TRIAL_DAYS = 7;
const STALE_ADMISSION_AGE_MS = 3 * 60 * 60 * 1000;
const CREATED_CUSTOMER_ID = "cus_created";
const CHECKOUT_URL = "https://checkout.example.test/session";
const MANAGED_PAYMENTS_ERROR =
  "Managed Payments is not supported on API version 2024-11-20.acacia.";

const createdSessions = new Map<string, Stripe.Checkout.Session>();
let mongodb: MongoMemoryReplSet;

beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({
    url: mongodb.getUri(),
    database: "saas-checkout-admission",
  });
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  createdSessions.clear();
  stripe.customers.create.mockResolvedValue({ id: CREATED_CUSTOMER_ID });
  stripe.customers.retrieve.mockImplementation(async (id: string) => ({
    id,
    deleted: false,
  }));
  stripe.customers.del.mockResolvedValue({ deleted: true });
  stripe.checkout.sessions.expire.mockImplementation(async (id: string) => {
    const session = createdSessions.get(id);
    if (!session) return { id, status: "expired" };
    return settleSession(id, "expired");
  });
  stripe.checkout.sessions.create.mockImplementation(
    async (params: Stripe.Checkout.SessionCreateParams) => {
      const session = {
        id: `cs_${randomUUID()}`,
        url: CHECKOUT_URL,
        metadata: params.metadata,
        status: "open",
        expires_at: params.expires_at,
        mode: "subscription",
      } as Stripe.Checkout.Session;
      createdSessions.set(session.id, session);
      return session;
    },
  );
  stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) =>
    createdSessions.get(id),
  );
});

function settleSession(
  id: string,
  status: Stripe.Checkout.Session.Status,
): Stripe.Checkout.Session {
  const settled = { ...createdSessions.get(id), status };
  createdSessions.set(id, settled as Stripe.Checkout.Session);
  return settled as Stripe.Checkout.Session;
}

function invalidRequest(
  message: string,
  param?: string,
): Stripe.errors.StripeInvalidRequestError {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    param,
    type: "invalid_request_error",
    statusCode: 400,
  } as Stripe.errors.StripeRawError);
}

function connectionLost(): Stripe.errors.StripeConnectionError {
  return new Stripe.errors.StripeConnectionError({
    message: "An error occurred with our connection to Stripe.",
    type: "api_error",
  } as Stripe.errors.StripeRawError);
}

async function checkoutRequest(): Promise<PlanChangeRequest> {
  const tenantId = randomUUID();
  const tenantSubscriptionModel = GetModel(TenantSubscriptionModel, tenantId);
  const [id] = await tenantSubscriptionModel.insert({
    _id: tenantId,
    planId: "free",
    status: "active",
    isComplimentary: false,
    paidUsagePeriods: [],
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
  });
  return {
    tenantId,
    tenantSubscriptionModel,
    subscription: await tenantSubscriptionModel.get(id),
    user: Object.assign(new User(), {
      _id: randomUUID(),
      email: `${randomUUID()}@example.test`,
    }),
    newPlan: PlanModel.fromPlainData({
      _id: "hobby",
      trialDays: TRIAL_DAYS,
      paymentProviderRefs: { stripePriceId: "price_hobby" },
    }),
    body: {
      planId: "hobby",
      successUrl: "https://example.test/success",
      cancelUrl: "https://example.test/cancel",
    },
  };
}

async function reload(request: PlanChangeRequest): Promise<PlanChangeRequest> {
  const subscription = await request.tenantSubscriptionModel.findOne();
  return { ...request, subscription };
}

/** Recreates what a failed start left behind before admissions were rolled back. */
async function strandCheckoutAdmission(
  request: PlanChangeRequest,
  requestedAt: Date,
): Promise<PlanChangeRequest> {
  const model = request.tenantSubscriptionModel;
  const current = await model.findOne();
  if (!current) throw new Error("Missing fixture");
  await model.beginTransition(current, {
    operationId: randomUUID(),
    kind: "checkout",
    targetPlanId: "hobby",
    requestedAt,
  });
  return reload(request);
}

function trialReservationOf(request: PlanChangeRequest) {
  return GetModel(TrialIdentityModel).get(
    trialIdentityId("email", hashEmail(request.user.email)),
  );
}

function lastSessionParams(): Stripe.Checkout.SessionCreateParams &
  Record<string, unknown> {
  return stripe.checkout.sessions.create.mock.lastCall?.[0];
}

describe("paid checkout admission", () => {
  it("opens a checkout session that opts out of Managed Payments", async () => {
    const request = await checkoutRequest();

    const result = await startPaidCheckout(request);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    expect(lastSessionParams()).toMatchObject({
      mode: "subscription",
      customer: CREATED_CUSTOMER_ID,
      line_items: [{ price: "price_hobby", quantity: 1 }],
      managed_payments: { enabled: false },
      automatic_tax: { enabled: true },
      subscription_data: { trial_period_days: TRIAL_DAYS },
    });
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription).toMatchObject({
      stripeCustomerId: CREATED_CUSTOMER_ID,
      domainTransition: { kind: "checkout", targetPlanId: "hobby" },
    });
    expect(subscription?.stripeCheckoutSessionId).toBe(
      [...createdSessions.keys()][0],
    );
  });

  it("opens the session without the opt-out when the account rejects the parameter", async () => {
    const request = await checkoutRequest();
    stripe.checkout.sessions.create.mockRejectedValueOnce(
      invalidRequest("Received unknown parameter", "managed_payments[enabled]"),
    );

    const result = await startPaidCheckout(request);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(lastSessionParams()).not.toHaveProperty("managed_payments");
    expect(stripe.checkout.sessions.create.mock.calls[1][1]).toEqual(
      stripe.checkout.sessions.create.mock.calls[0][1],
    );
  });

  it("rolls back a checkout Stripe refuses so the owner can retry at once", async () => {
    const request = await checkoutRequest();
    stripe.checkout.sessions.create.mockRejectedValueOnce(
      invalidRequest(MANAGED_PAYMENTS_ERROR),
    );

    await expect(startPaidCheckout(request)).rejects.toMatchObject({
      status: 422,
      body: "saas.errors.billing.checkout_rejected",
    });

    const rolledBack = await request.tenantSubscriptionModel.findOne();
    expect(rolledBack).toMatchObject({
      planId: "free",
      domainTransition: null,
      stripeCustomerId: null,
      stripeCheckoutSessionId: null,
    });
    expect(stripe.customers.del).toHaveBeenCalledWith(CREATED_CUSTOMER_ID);
    expect((await trialReservationOf(request))?.tenantId).toBeNull();

    const retried = await startPaidCheckout(await reload(request));
    expect(retried.checkoutUrl).toBe(CHECKOUT_URL);
    expect(lastSessionParams().subscription_data?.trial_period_days).toBe(
      TRIAL_DAYS,
    );
  });

  it("expires a session Stripe opened without a redirect URL before rolling back", async () => {
    const request = await checkoutRequest();
    stripe.checkout.sessions.create.mockResolvedValueOnce({
      id: "cs_without_url",
      url: null,
    });

    await expect(startPaidCheckout(request)).rejects.toMatchObject({
      status: 422,
      body: "saas.errors.billing.checkout_rejected",
    });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_without_url",
    );
    expect(
      (await request.tenantSubscriptionModel.findOne())?.domainTransition,
    ).toBeNull();
  });

  it("keeps an uncertain failure admitted until no request can still record it", async () => {
    const request = await checkoutRequest();
    stripe.checkout.sessions.create.mockRejectedValueOnce(connectionLost());

    await expect(startPaidCheckout(request)).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.billing.checkout_unavailable",
    });
    const retained = await reload(request);
    expect(retained.subscription?.domainTransition?.kind).toBe("checkout");
    expect(stripe.customers.del).not.toHaveBeenCalled();

    await expect(startPaidCheckout(retained)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_in_progress",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + UNRECORDED_CHECKOUT_TTL_MS);
    const recovered = await startPaidCheckout(retained);
    expect(recovered.checkoutUrl).toBe(CHECKOUT_URL);
  });

  it("clears a checkout admission stranded by an earlier failed start", async () => {
    const request = await strandCheckoutAdmission(
      await checkoutRequest(),
      new Date(Date.now() - STALE_ADMISSION_AGE_MS),
    );
    const stranded = request.subscription?.domainTransition;

    const result = await startPaidCheckout(request);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription?.domainTransition?.kind).toBe("checkout");
    expect(subscription?.domainTransition?.operationId).not.toBe(
      stranded?.operationId,
    );
    expect(subscription?.stripeCheckoutSessionId).toBeTruthy();
  });

  it("releases a recorded session whose expiry webhook never arrived", async () => {
    const request = await checkoutRequest();
    await startPaidCheckout(request);
    const pending = await reload(request);
    const recordedId = pending.subscription?.stripeCheckoutSessionId ?? "";
    createdSessions.set(recordedId, {
      ...createdSessions.get(recordedId),
      status: "expired",
    } as Stripe.Checkout.Session);

    const result = await startPaidCheckout(pending);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription?.stripeCheckoutSessionId).not.toBe(recordedId);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
  });

  it("reports a pending change of another kind as in progress", async () => {
    const request = await checkoutRequest();
    const current = await request.tenantSubscriptionModel.findOne();
    if (!current) throw new Error("Missing fixture");
    await request.tenantSubscriptionModel.beginTransition(current, {
      operationId: randomUUID(),
      kind: "change_plan",
      targetPlanId: "pro",
      requestedAt: new Date(Date.now() - STALE_ADMISSION_AGE_MS),
    });

    await expect(
      startPaidCheckout(await reload(request)),
    ).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.change_in_progress",
    });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

interface RecordedCheckout {
  request: PlanChangeRequest;
  sessionId: string;
  operationId: string;
}

/** An owner who opened Stripe Checkout and closed the tab without paying. */
async function abandonCheckout(): Promise<RecordedCheckout> {
  const request = await checkoutRequest();
  await startPaidCheckout(request);
  const pending = await reload(request);
  return {
    request: pending,
    sessionId: pending.subscription?.stripeCheckoutSessionId ?? "",
    operationId: pending.subscription?.domainTransition?.operationId ?? "",
  };
}

function cancel(checkout: RecordedCheckout, operationId: string | null) {
  return cancelPendingCheckout(
    checkout.request.subscription,
    checkout.request.tenantSubscriptionModel,
    operationId,
  );
}

function expiredEvent(session: Stripe.Checkout.Session): Stripe.Event {
  return { data: { object: session } } as Stripe.Event;
}

describe("abandoned checkout recovery", () => {
  it("opens sessions that expire after the shortest lifetime Stripe accepts", async () => {
    const before = Date.now();
    const { operationId } = await abandonCheckout();

    const params = lastSessionParams();
    const lifetimeMs = (params.expires_at ?? 0) * 1000 - before;
    expect(lifetimeMs).toBeGreaterThanOrEqual(CHECKOUT_SESSION_LIFETIME_MS);
    expect(lifetimeMs).toBeLessThan(2 * CHECKOUT_SESSION_LIFETIME_MS);
    const cancelUrl = new URL(params.cancel_url ?? "");
    expect(cancelUrl.pathname).toBe("/cancel");
    expect(cancelUrl.searchParams.get("checkout")).toBe("cancelled");
    expect(cancelUrl.searchParams.get("checkoutOperation")).toBe(operationId);
  });

  it("offers an open session for resumption, then expires it when the owner starts over", async () => {
    const checkout = await abandonCheckout();

    await expect(startPaidCheckout(checkout.request)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_in_progress",
    });
    const { pending } = await describePendingCheckout(
      checkout.request.subscription,
    );
    expect(pending).toMatchObject({
      targetPlanId: "hobby",
      checkoutUrl: CHECKOUT_URL,
      isPaid: false,
    });

    await expect(cancel(checkout, null)).resolves.toEqual({ released: true });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      checkout.sessionId,
    );
    const restarted = await startPaidCheckout(await reload(checkout.request));

    expect(restarted.checkoutUrl).toBe(CHECKOUT_URL);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    expect(lastSessionParams().subscription_data?.trial_period_days).toBe(
      TRIAL_DAYS,
    );
  });

  it("releases a legacy session opened with Stripe's 24-hour default", async () => {
    const checkout = await abandonCheckout();
    createdSessions.set(checkout.sessionId, {
      ...createdSessions.get(checkout.sessionId),
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    } as Stripe.Checkout.Session);

    await expect(cancel(checkout, null)).resolves.toEqual({ released: true });

    expect(createdSessions.get(checkout.sessionId)?.status).toBe("expired");
    const released = await checkout.request.tenantSubscriptionModel.findOne();
    expect(released).toMatchObject({
      domainTransition: null,
      stripeCheckoutSessionId: null,
    });
  });

  it("releases the checkout the owner cancelled on Stripe's page", async () => {
    const checkout = await abandonCheckout();

    await expect(cancel(checkout, checkout.operationId)).resolves.toEqual({
      released: true,
    });

    expect(createdSessions.get(checkout.sessionId)?.status).toBe("expired");
    expect((await trialReservationOf(checkout.request))?.tenantId).toBeNull();
    const retried = await startPaidCheckout(await reload(checkout.request));
    expect(retried.checkoutUrl).toBe(CHECKOUT_URL);
  });

  it("ignores a cancel link that belongs to another checkout", async () => {
    const checkout = await abandonCheckout();

    await expect(cancel(checkout, randomUUID())).resolves.toEqual({
      released: false,
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    const pending = await checkout.request.tenantSubscriptionModel.findOne();
    expect(pending?.stripeCheckoutSessionId).toBe(checkout.sessionId);
  });

  it("releases the checkout and its trial when Stripe reports the session expired", async () => {
    const checkout = await abandonCheckout();
    const expired = settleSession(checkout.sessionId, "expired");

    await handleCheckoutSessionExpired(expiredEvent(expired));

    const released = await checkout.request.tenantSubscriptionModel.findOne();
    expect(released).toMatchObject({
      domainTransition: null,
      stripeCheckoutSessionId: null,
    });
    expect((await trialReservationOf(checkout.request))?.tenantId).toBeNull();
    const retried = await startPaidCheckout(await reload(checkout.request));
    expect(retried.checkoutUrl).toBe(CHECKOUT_URL);
  });

  it("never releases a session the owner already paid", async () => {
    const checkout = await abandonCheckout();
    settleSession(checkout.sessionId, "complete");

    await expect(cancel(checkout, checkout.operationId)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_already_paid",
    });
    await expect(startPaidCheckout(checkout.request)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_in_progress",
    });

    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    const { pending } = await describePendingCheckout(
      checkout.request.subscription,
    );
    expect(pending).toMatchObject({ checkoutUrl: null, isPaid: true });
    const retained = await checkout.request.tenantSubscriptionModel.findOne();
    expect(retained?.domainTransition?.operationId).toBe(checkout.operationId);
    expect(retained?.stripeCheckoutSessionId).toBe(checkout.sessionId);
  });

  it("keeps a session the owner completed just before Stripe refused its expiry", async () => {
    const checkout = await abandonCheckout();
    stripe.checkout.sessions.expire.mockImplementationOnce(async () => {
      settleSession(checkout.sessionId, "complete");
      throw invalidRequest("This Checkout Session is not open.");
    });

    await expect(cancel(checkout, null)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.plan.checkout_already_paid",
    });

    const retained = await checkout.request.tenantSubscriptionModel.findOne();
    expect(retained?.domainTransition?.operationId).toBe(checkout.operationId);
  });
});
