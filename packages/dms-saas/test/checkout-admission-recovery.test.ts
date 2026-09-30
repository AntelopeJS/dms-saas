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
import {
  startPaidCheckout,
  UNRECORDED_CHECKOUT_TTL_MS,
} from "../src/routes/tenant/tenant-plan-checkout";
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
  stripe.checkout.sessions.expire.mockResolvedValue({ status: "expired" });
  stripe.checkout.sessions.create.mockImplementation(
    async (params: Stripe.Checkout.SessionCreateParams) => {
      const session = {
        id: `cs_${randomUUID()}`,
        url: CHECKOUT_URL,
        metadata: params.metadata,
        status: "open",
      } as Stripe.Checkout.Session;
      createdSessions.set(session.id, session);
      return session;
    },
  );
  stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) =>
    createdSessions.get(id),
  );
});

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
