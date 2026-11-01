import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { User } from "@antelopejs/interface-dms/auth/db/tables/users.table";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import {
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
  isTrialOfferedOnChange,
  startPaidCheckout,
} from "../src/routes/tenant/tenant-plan-checkout";
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
import { useMongoDatabase } from "./helpers/mongo";
import { allowCheckoutRedirects } from "./helpers/workspaces";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("checkout-admission");
const stripe = useSuiteStripe();

const TRIAL_DAYS = 7;
const STALE_ADMISSION_AGE_MS = 3 * 60 * 60 * 1000;
const CREATED_CUSTOMER_ID = "cus_created";
const CHECKOUT_URL = "https://checkout.example.test/session";
const MANAGED_PAYMENTS_ERROR =
  "Managed Payments is not supported on API version 2024-11-20.acacia.";

const createdSessions = new Map<string, Stripe.Checkout.Session>();

beforeAll(allowCheckoutRedirects);

afterEach(() => {
  vi.useRealTimers();
});

function stubStripe() {
  return {
    createCustomer: vi
      .spyOn(stripe.write.customers, "create")
      .mockResolvedValue(fromPartial({ id: CREATED_CUSTOMER_ID })),
    retrieveCustomer: vi
      .spyOn(stripe.write.customers, "retrieve")
      .mockImplementation(async (id) => fromPartial({ id })),
    deleteCustomer: vi
      .spyOn(stripe.write.customers, "del")
      .mockResolvedValue(fromPartial({ deleted: true })),
    expireSession: vi
      .spyOn(stripe.write.checkout.sessions, "expire")
      .mockImplementation(async (id) =>
        fromPartial(
          createdSessions.has(id)
            ? settleSession(id, "expired")
            : { id, status: "expired" },
        ),
      ),
    createSession: vi
      .spyOn(stripe.write.checkout.sessions, "create")
      .mockImplementation(async (params) => {
        const session = fromPartial<Stripe.Checkout.Session>({
          id: `cs_${randomUUID()}`,
          url: CHECKOUT_URL,
          status: "open",
          metadata: Object.fromEntries(
            Object.entries(params?.metadata ?? {}).map(([key, value]) => [
              key,
              String(value),
            ]),
          ),
          expires_at: params?.expires_at,
          mode: "subscription",
        });
        createdSessions.set(session.id, session);
        return fromPartial(session);
      }),
    retrieveSession: vi
      .spyOn(stripe.write.checkout.sessions, "retrieve")
      .mockImplementation(async (id) =>
        fromPartial(createdSessions.get(id) ?? {}),
      ),
  };
}

let api: ReturnType<typeof stubStripe>;

beforeEach(() => {
  createdSessions.clear();
  api = stubStripe();
});

function settleSession(
  id: string,
  status: Stripe.Checkout.Session.Status,
): Stripe.Checkout.Session {
  const settled = fromPartial<Stripe.Checkout.Session>({
    ...createdSessions.get(id),
    status,
  });
  createdSessions.set(id, settled);
  return settled;
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
  });
}

function connectionLost(): Stripe.errors.StripeConnectionError {
  return new Stripe.errors.StripeConnectionError({
    message: "An error occurred with our connection to Stripe.",
    type: "api_error",
  });
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

function lastSessionParams() {
  return api.createSession.mock.lastCall?.[0];
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
    api.createSession.mockRejectedValueOnce(
      invalidRequest("Received unknown parameter", "managed_payments[enabled]"),
    );

    const result = await startPaidCheckout(request);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(lastSessionParams()).not.toHaveProperty("managed_payments");
    expect(api.createSession.mock.calls[1][1]).toEqual(
      api.createSession.mock.calls[0][1],
    );
  });

  it("rolls back a checkout Stripe refuses so the owner can retry at once", async () => {
    const request = await checkoutRequest();
    api.createSession.mockRejectedValueOnce(
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
    expect(api.deleteCustomer).toHaveBeenCalledWith(CREATED_CUSTOMER_ID);
    expect((await trialReservationOf(request))?.tenantId).toBeNull();

    const retried = await startPaidCheckout(await reload(request));
    expect(retried.checkoutUrl).toBe(CHECKOUT_URL);
    expect(lastSessionParams()?.subscription_data?.trial_period_days).toBe(
      TRIAL_DAYS,
    );
  });

  it("expires a session Stripe opened without a redirect URL before rolling back", async () => {
    const request = await checkoutRequest();
    api.createSession.mockResolvedValueOnce(
      fromPartial({ id: "cs_without_url", url: null }),
    );

    await expect(startPaidCheckout(request)).rejects.toMatchObject({
      status: 422,
      body: "saas.errors.billing.checkout_rejected",
    });
    expect(api.expireSession).toHaveBeenCalledWith("cs_without_url");
    expect(
      (await request.tenantSubscriptionModel.findOne())?.domainTransition,
    ).toBeNull();
  });

  it("keeps an uncertain failure admitted until no request can still record it", async () => {
    const request = await checkoutRequest();
    api.createSession.mockRejectedValueOnce(connectionLost());

    await expect(startPaidCheckout(request)).rejects.toMatchObject({
      status: 503,
      body: "saas.errors.billing.checkout_unavailable",
    });
    const retained = await reload(request);
    expect(retained.subscription?.domainTransition?.kind).toBe("checkout");
    expect(api.deleteCustomer).not.toHaveBeenCalled();

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
    expect(api.retrieveSession).not.toHaveBeenCalled();
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
    settleSession(recordedId, "expired");

    const result = await startPaidCheckout(pending);

    expect(result.checkoutUrl).toBe(CHECKOUT_URL);
    const subscription = await request.tenantSubscriptionModel.findOne();
    expect(subscription?.stripeCheckoutSessionId).not.toBe(recordedId);
    expect(api.createSession).toHaveBeenCalledTimes(2);
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
    expect(api.createSession).not.toHaveBeenCalled();
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

function expiredEvent(session: Stripe.Checkout.Session) {
  return fromPartial<Stripe.CheckoutSessionExpiredEvent>({
    data: { object: session },
  });
}

describe("abandoned checkout recovery", () => {
  it("opens sessions that expire after the shortest lifetime Stripe accepts", async () => {
    const before = Date.now();
    const { operationId } = await abandonCheckout();

    const params = lastSessionParams();
    const lifetimeMs = (params?.expires_at ?? 0) * 1000 - before;
    expect(lifetimeMs).toBeGreaterThanOrEqual(CHECKOUT_SESSION_LIFETIME_MS);
    expect(lifetimeMs).toBeLessThan(2 * CHECKOUT_SESSION_LIFETIME_MS);
    const cancelUrl = new URL(params?.cancel_url ?? "");
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
    expect(api.expireSession).toHaveBeenCalledWith(checkout.sessionId);
    const restarted = await startPaidCheckout(await reload(checkout.request));

    expect(restarted.checkoutUrl).toBe(CHECKOUT_URL);
    expect(api.createSession).toHaveBeenCalledTimes(2);
    expect(lastSessionParams()?.subscription_data?.trial_period_days).toBe(
      TRIAL_DAYS,
    );
  });

  it("releases a legacy session opened with Stripe's 24-hour default", async () => {
    const checkout = await abandonCheckout();
    createdSessions.set(
      checkout.sessionId,
      fromPartial({
        ...createdSessions.get(checkout.sessionId),
        expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      }),
    );

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

    expect(api.expireSession).not.toHaveBeenCalled();
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

    expect(api.expireSession).not.toHaveBeenCalled();
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
    api.expireSession.mockImplementationOnce(async () => {
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

describe("trial offered in the plan comparison", () => {
  it("offers the plan's trial to an owner who never had one", async () => {
    const { newPlan, subscription, user } = await checkoutRequest();

    await expect(
      isTrialOfferedOnChange(newPlan, subscription, user.email),
    ).resolves.toBe(true);
  });

  it("offers no trial once the owner's trial is taken", async () => {
    const { newPlan, subscription, user, tenantId } = await checkoutRequest();
    await GetModel(TrialIdentityModel).reserve(
      trialIdentityId("email", hashEmail(user.email)),
      tenantId,
    );

    await expect(
      isTrialOfferedOnChange(newPlan, subscription, user.email),
    ).resolves.toBe(false);
  });

  it("offers no trial on a change of a live Stripe subscription", async () => {
    const { newPlan, subscription, user } = await checkoutRequest();
    const subscribed = Object.assign(subscription!, {
      stripeSubscriptionId: "sub_live",
    });

    await expect(
      isTrialOfferedOnChange(newPlan, subscribed, user.email),
    ).resolves.toBe(false);
  });
});
