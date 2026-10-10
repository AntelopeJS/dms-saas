import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Plan,
  TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";

const harness = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  retrieveInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  recompute: vi.fn(),
  plans: [] as Plan[],
  local: undefined as TenantSubscription | undefined,
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Error: vi.fn(), Warn: vi.fn(), Info: vi.fn() },
}));
vi.mock(
  "@antelopejs/interface-database-decorators",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >()),
    GetModel: (model: { name: string }) =>
      ({
        PlanModel: { findNotDeleted: async () => harness.plans },
        TenantSubscriptionModel: webhookModel,
      })[model.name],
  }),
);
vi.mock("../src/billing-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/billing-state")>()),
  recomputeTenantBillingState: (...args: unknown[]) =>
    harness.recompute(...args),
}));
vi.mock("../src/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/plans")>()),
  syncStripeSeatQuantity: vi.fn(),
}));
vi.mock("../src/workers", () => ({ applyPlanDowngradeCleanup: vi.fn() }));
vi.mock("../src/stripe/webhook-shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/stripe/webhook-shared")>()),
  findTenantByCustomerId: async () => ({ _id: "tenant-a" }),
}));
vi.mock("../src/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: harness.retrieveSubscription },
    invoices: {
      retrieve: harness.retrieveInvoice,
      voidInvoice: harness.voidInvoice,
    },
  }),
}));

import {
  confirmOwnerUpgrade,
  handleSubscriptionPendingUpdateApplied,
} from "../src/routes/tenant/tenant-plan-authentication";

const SUBSCRIPTION = {
  _id: "tenant-a",
  planId: "business",
  status: "active",
  stripeCustomerId: "cus_a",
  stripeSubscriptionId: "sub_a",
} as TenantSubscription;

const ENTERPRISE = {
  _id: "enterprise",
  billingMode: "flat",
  paymentProviderRefs: { stripePriceId: "price_enterprise" },
} as Plan;

function subscriptionModel() {
  return {
    findOne: vi.fn(async () => harness.local),
    beginTransition: vi.fn(async () => undefined),
    updateDuringTransition: vi.fn(async () => undefined),
    completeTransition: vi.fn(async () => undefined),
  };
}

const webhookModel = subscriptionModel();

function stripeSubscription(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_a",
    customer: "cus_a",
    pending_update: null,
    latest_invoice: "in_upgrade",
    items: { data: [{ price: { id: "price_enterprise" } }] },
    ...overrides,
  } as Stripe.Subscription;
}

const PENDING = {
  pending_update: { expires_at: 1 },
} as Partial<Stripe.Subscription>;

function upgradePayment(status: string) {
  harness.retrieveInvoice.mockResolvedValue({
    payments: { data: [{ payment: { payment_intent: { status } } }] },
  });
}

function confirm(model = subscriptionModel()) {
  return confirmOwnerUpgrade(
    "tenant-a",
    SUBSCRIPTION,
    ENTERPRISE,
    model as unknown as TenantSubscriptionModel,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.plans = [ENTERPRISE];
  harness.local = SUBSCRIPTION;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("confirming an authenticated upgrade", () => {
  it("records the plan Stripe applied once the challenge was passed", async () => {
    harness.retrieveSubscription.mockResolvedValue(stripeSubscription());
    const model = subscriptionModel();

    await expect(confirm(model)).resolves.toMatchObject({
      changed: true,
      planId: "enterprise",
      authentication: null,
    });
    expect(model.updateDuringTransition).toHaveBeenCalledWith(
      "tenant-a",
      expect.any(String),
      expect.objectContaining({ planId: "enterprise" }),
    );
    expect(model.completeTransition).toHaveBeenCalledTimes(1);
    expect(harness.recompute).toHaveBeenCalledWith("tenant-a");
  });

  it("waits for Stripe to apply a payment it just took", async () => {
    vi.useFakeTimers();
    harness.retrieveSubscription
      .mockResolvedValueOnce(stripeSubscription(PENDING))
      .mockResolvedValueOnce(stripeSubscription());
    upgradePayment("succeeded");
    const model = subscriptionModel();

    const confirmed = confirm(model);
    await vi.runAllTimersAsync();

    await expect(confirmed).resolves.toMatchObject({ changed: true });
    expect(harness.voidInvoice).not.toHaveBeenCalled();
    expect(model.updateDuringTransition).toHaveBeenCalledTimes(1);
  });

  it("drops the upgrade when the challenge was failed or abandoned", async () => {
    harness.retrieveSubscription.mockResolvedValue(stripeSubscription(PENDING));
    upgradePayment("requires_action");
    const model = subscriptionModel();

    await expect(confirm(model)).rejects.toMatchObject({
      status: 402,
      body: "saas.errors.plan.upgrade_authentication_failed",
    });
    expect(harness.voidInvoice).toHaveBeenCalledWith("in_upgrade");
    expect(model.beginTransition).not.toHaveBeenCalled();
  });

  it("refuses a plan Stripe does not bill", async () => {
    harness.retrieveSubscription.mockResolvedValue(
      stripeSubscription({
        items: { data: [{ price: { id: "price_business" } }] },
      } as Partial<Stripe.Subscription>),
    );

    await expect(confirm()).rejects.toMatchObject({ status: 409 });
  });

  it("answers at once when the webhook already recorded the plan", async () => {
    const model = subscriptionModel();

    await expect(
      confirmOwnerUpgrade(
        "tenant-a",
        { ...SUBSCRIPTION, planId: "enterprise" },
        ENTERPRISE,
        model as unknown as TenantSubscriptionModel,
      ),
    ).resolves.toMatchObject({ changed: true });
    expect(harness.retrieveSubscription).not.toHaveBeenCalled();
    expect(model.beginTransition).not.toHaveBeenCalled();
  });
});

describe("customer.subscription.pending_update_applied", () => {
  const applied = (subscription: Stripe.Subscription) =>
    ({
      type: "customer.subscription.pending_update_applied",
      data: { object: subscription },
    }) as Stripe.Event;

  it("records the upgrade an owner paid without coming back", async () => {
    await handleSubscriptionPendingUpdateApplied(applied(stripeSubscription()));

    expect(webhookModel.updateDuringTransition).toHaveBeenCalledWith(
      "tenant-a",
      expect.any(String),
      expect.objectContaining({ planId: "enterprise" }),
    );
  });

  it("leaves a workspace already on the plan as it is", async () => {
    harness.local = { ...SUBSCRIPTION, planId: "enterprise" };

    await handleSubscriptionPendingUpdateApplied(applied(stripeSubscription()));

    expect(webhookModel.beginTransition).not.toHaveBeenCalled();
  });

  it("ignores a subscription the workspace no longer bills on", async () => {
    await handleSubscriptionPendingUpdateApplied(
      applied(stripeSubscription({ id: "sub_old" })),
    );

    expect(webhookModel.beginTransition).not.toHaveBeenCalled();
  });
});
