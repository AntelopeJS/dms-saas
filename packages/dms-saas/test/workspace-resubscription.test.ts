import { randomUUID } from "node:crypto";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import {
  GetModel,
  RegisterSchema,
} from "@antelopejs/interface-database-decorators";
import { construct, destroy } from "@antelopejs/mongodb";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";
import type Stripe from "stripe";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  PlanModel,
  type TenantBillingInfo,
  type TenantBillingInfoModel,
  type TenantSubscription,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasBillingSelfRefundController } from "../src/routes/tenant/billing-self-refund";
import { SaasTenantPlanController } from "../src/routes/tenant/tenant-plan";
import { resolvePlanChangeKind } from "../src/routes/tenant/tenant-plan-preview";
import { handleCheckoutSessionCompleted } from "../src/stripe/webhook-checkout";
import {
  canResubscribe,
  liveStripeSubscriptionId,
} from "../src/workspaces/first-payment";

const harness = vi.hoisted(() => ({
  tenantId: "",
  assertAccess: vi.fn(),
  plans: new Map<string, unknown>(),
}));
const stripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  customers: { create: vi.fn(), update: vi.fn() },
  checkout: {
    sessions: { create: vi.fn(), expire: vi.fn(), retrieve: vi.fn() },
  },
  invoices: { list: vi.fn() },
}));
vi.mock("../src/stripe/client", () => ({ getStripeClient: () => stripe }));
vi.mock("../src/config", () => ({ isAllowedRedirectUrl: () => true }));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/automation", () => ({ emitAutomationEvent: () => undefined }));
vi.mock("../src/workers", () => ({
  applyPlanDowngradeCleanup: async () => undefined,
}));
vi.mock("@antelopejs/interface-dms/tenant-access", () => ({
  AssertTenantAccess: (...args: unknown[]) => harness.assertAccess(...args),
}));
vi.mock("@antelopejs/interface-dms/request-tenant", () => ({
  getRequestTenantId: () => harness.tenantId,
}));
vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));
vi.mock("../src/routes/tenant/tenant-plan-ops", async (original) => ({
  ...(await original()),
  loadAndValidateTargetPlan: async (_model: unknown, planId: string) =>
    harness.plans.get(planId),
  assertSeatLimit: async () => undefined,
}));

const SETUP_TIMEOUT_MS = 60_000;
const KEPT_CUSTOMER = "cus_kept";
const ENDED_SUBSCRIPTION = "sub_ended";
const NEW_SUBSCRIPTION = "sub_new";
const CARD = "card-fingerprint";
const REFUNDED_AT = new Date("2026-09-01T10:00:00Z");
const PAID_PLAN = PlanModel.fromPlainData({
  _id: "pro",
  name: "Pro",
  price: 49,
  trialDays: 0,
  billingMode: "flat",
  paymentProviderRefs: { stripePriceId: "price_pro" },
});
const FREE_PLAN = PlanModel.fromPlainData({
  _id: "free",
  name: "Free",
  price: 0,
  trialDays: 0,
  billingMode: "flat",
  paymentProviderRefs: null,
});
const COMPLETE_IDENTITY = {
  customerType: "individual",
  companyName: null,
  vatNumber: null,
  billingEmail: "billing@example.test",
  address: {
    line1: "1 rue de la Paix",
    line2: null,
    postalCode: "75002",
    city: "Paris",
    state: null,
    country: "FR",
  },
} as TenantBillingInfo;

let mongodb: MongoMemoryReplSet;
beforeAll(async () => {
  mongodb = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "8.0.8" },
  });
  await construct({ url: mongodb.getUri(), database: "saas-resubscription" });
  await RegisterSchema("dms-core");
  await RegisterSchema("dms-tenant");
  await GetModel(PlanModel).insert([
    { ...PAID_PLAN, isActive: true },
    { ...FREE_PLAN, isActive: true },
  ]);
}, SETUP_TIMEOUT_MS);
afterAll(async () => {
  try {
    await destroy();
  } finally {
    await mongodb?.stop();
  }
});
beforeEach(async () => {
  vi.clearAllMocks();
  harness.plans = new Map<string, unknown>([
    [PAID_PLAN._id, PAID_PLAN],
    [FREE_PLAN._id, FREE_PLAN],
  ]);
  harness.assertAccess.mockRejectedValue(new Error("Workspace is blocked"));
  await GetModel(BillingSettingsModel).delete(BILLING_SETTINGS_SINGLETON_ID);
  stripe.customers.create.mockResolvedValue({ id: "cus_created" });
  stripe.customers.update.mockResolvedValue({ id: KEPT_CUSTOMER });
  stripe.checkout.sessions.create.mockImplementation(
    async (params: Stripe.Checkout.SessionCreateParams) => ({
      id: randomUUID(),
      url: "https://checkout.example.test/session",
      metadata: params.metadata,
    }),
  );
  stripe.subscriptions.retrieve.mockResolvedValue({
    id: NEW_SUBSCRIPTION,
    customer: KEPT_CUSTOMER,
    default_payment_method: "pm_new",
    status: "active",
    start_date: 1_900_000_000,
    items: { data: [{ current_period_end: 1_902_000_000 }] },
  });
});

function owner(): User {
  return { _id: "owner", owner: false, email: "owner@example.test" } as User;
}

async function seedCancelledWorkspace(
  patch: Partial<TenantSubscription> = {},
): Promise<TenantSubscriptionModel> {
  harness.tenantId = randomUUID();
  const model = GetModel(TenantSubscriptionModel, harness.tenantId);
  await model.insert({
    _id: harness.tenantId,
    planId: PAID_PLAN._id,
    status: "cancelled",
    isComplimentary: false,
    stripeCustomerId: KEPT_CUSTOMER,
    stripeSubscriptionId: ENDED_SUBSCRIPTION,
    cardFingerprint: CARD,
    refundRequestedAt: REFUNDED_AT,
    createdBy: "owner",
    paidUsagePeriods: [
      {
        stripeSubscriptionId: ENDED_SUBSCRIPTION,
        start: new Date("2026-08-01T00:00:00Z"),
        end: null,
      },
    ],
    ...patch,
  });
  return model;
}

async function seedFreeWorkspaceOnCard(): Promise<void> {
  const tenantId = randomUUID();
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId: FREE_PLAN._id,
    status: "active",
    isComplimentary: false,
    cardFingerprint: CARD,
    paidUsagePeriods: [],
  });
}

function choosePlan(planId: string, model: TenantSubscriptionModel) {
  const controller = new SaasTenantPlanController();
  controller.tenantModel = {
    get: async (_id: string) => ({ _id }),
  } as never;
  const billingInfo = {
    findOne: async () => COMPLETE_IDENTITY,
  } as TenantBillingInfoModel;
  return controller.changePlan(
    owner(),
    {
      planId,
      successUrl: "https://example.test/billing",
      cancelUrl: "https://example.test/billing",
    },
    {},
    model,
    billingInfo,
  );
}

async function completionEvent(
  model: TenantSubscriptionModel,
): Promise<Stripe.Event> {
  const current = await model.findOne();
  return {
    id: randomUUID(),
    type: "checkout.session.completed",
    data: {
      object: {
        id: current?.stripeCheckoutSessionId,
        mode: "subscription",
        status: "complete",
        subscription: NEW_SUBSCRIPTION,
        metadata: {
          tenantId: harness.tenantId,
          planId: PAID_PLAN._id,
          operationId: current?.domainTransition?.operationId,
        },
      },
    },
  } as Stripe.Event;
}

function readRefundEligibility(model: TenantSubscriptionModel) {
  const settings = {
    get: async () => ({
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: 30,
      moneyBackGuaranteeMode: "full",
    }),
  } as unknown as BillingSettingsModel;
  return new SaasBillingSelfRefundController().getRefundEligibility(
    owner(),
    settings,
    model,
  );
}

describe("resubscription eligibility", () => {
  it("is open to a cancelled workspace until its deletion is admitted", () => {
    const cancelled = { status: "cancelled" } as TenantSubscription;
    expect(canResubscribe(cancelled)).toBe(true);
    expect(
      canResubscribe({ ...cancelled, deletionStartedAt: new Date() }),
    ).toBe(false);
    expect(canResubscribe({ status: "suspended" } as TenantSubscription)).toBe(
      false,
    );
  });

  it("treats the subscription Stripe ended as no subscription", () => {
    const ended = {
      status: "cancelled",
      stripeSubscriptionId: ENDED_SUBSCRIPTION,
    } as TenantSubscription;
    expect(liveStripeSubscriptionId(ended)).toBeNull();
    expect(resolvePlanChangeKind(ended, PAID_PLAN, PAID_PLAN)).toBe("checkout");
    expect(resolvePlanChangeKind(ended, PAID_PLAN, FREE_PLAN)).toBe("free");
    expect(liveStripeSubscriptionId({ ...ended, status: "past_due" })).toBe(
      ENDED_SUBSCRIPTION,
    );
  });
});

describe("a cancelled workspace choosing a plan again", () => {
  it("pays the plan it was cancelled on through Checkout on its own Stripe customer", async () => {
    const model = await seedCancelledWorkspace();

    const result = await choosePlan(PAID_PLAN._id, model);

    expect(result.checkoutUrl).toBe("https://checkout.example.test/session");
    expect(harness.assertAccess).not.toHaveBeenCalled();
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: KEPT_CUSTOMER }),
      expect.anything(),
    );
    expect(await model.findOne()).toMatchObject({
      status: "cancelled",
      domainTransition: expect.objectContaining({ kind: "checkout" }),
    });
  });

  it("becomes active on the new plan once Stripe reports the checkout complete", async () => {
    const model = await seedCancelledWorkspace();
    await choosePlan(PAID_PLAN._id, model);

    await handleCheckoutSessionCompleted(await completionEvent(model));

    const reopened = await model.findOne();
    expect(reopened).toMatchObject({
      status: "active",
      planId: PAID_PLAN._id,
      stripeCustomerId: KEPT_CUSTOMER,
      stripeSubscriptionId: NEW_SUBSCRIPTION,
      cardFingerprint: CARD,
      domainTransition: null,
    });
    expect(reopened?.paidUsagePeriods).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: ENDED_SUBSCRIPTION,
        end: expect.any(Date),
      }),
      expect.objectContaining({
        stripeSubscriptionId: NEW_SUBSCRIPTION,
        end: null,
      }),
    ]);
  });

  it("does not grant the money-back guarantee a second time", async () => {
    const model = await seedCancelledWorkspace();
    await choosePlan(PAID_PLAN._id, model);
    await handleCheckoutSessionCompleted(await completionEvent(model));

    const eligibility = await readRefundEligibility(model);

    expect(eligibility).toMatchObject({
      eligible: false,
      reason: "already_processed",
      refundedAt: REFUNDED_AT,
    });
    expect(stripe.invoices.list).not.toHaveBeenCalled();
  });

  it("resumes on a free plan as a local free subscription, keeping its customer", async () => {
    const model = await seedCancelledWorkspace();

    await expect(choosePlan(FREE_PLAN._id, model)).resolves.toMatchObject({
      changed: true,
      planId: FREE_PLAN._id,
      checkoutUrl: null,
    });

    const resumed = await model.findOne();
    expect(resumed).toMatchObject({
      status: "active",
      planId: FREE_PLAN._id,
      stripeCustomerId: KEPT_CUSTOMER,
      stripeSubscriptionId: null,
      refundRequestedAt: REFUNDED_AT,
    });
    expect(resumed?.paidUsagePeriods[0]?.end).toBeInstanceOf(Date);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(harness.assertAccess).not.toHaveBeenCalled();
  });

  it("refuses a free plan once its card backs as many free workspaces as allowed", async () => {
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      maxFreeWorkspacesPerCard: 1,
    });
    await seedFreeWorkspaceOnCard();
    const model = await seedCancelledWorkspace();

    await expect(choosePlan(FREE_PLAN._id, model)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    expect((await model.findOne())?.status).toBe("cancelled");
  });

  it("counts the reopened workspace against its card afterwards", async () => {
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      maxFreeWorkspacesPerCard: 2,
    });
    const card = randomUUID();
    const first = await seedCancelledWorkspace({ cardFingerprint: card });
    await choosePlan(FREE_PLAN._id, first);
    const second = await seedCancelledWorkspace({ cardFingerprint: card });
    await choosePlan(FREE_PLAN._id, second);
    const third = await seedCancelledWorkspace({ cardFingerprint: card });

    await expect(choosePlan(FREE_PLAN._id, third)).rejects.toMatchObject({
      status: 409,
      body: "saas.errors.workspace.free_card_limit_reached",
    });
    const onCard = await GetModel(
      TenantSubscriptionModel,
      CROSS_INSTANCE,
    ).findByCardFingerprint(card);
    expect(onCard.filter((row) => row.status === "active")).toHaveLength(2);
  });

  it("leaves a workspace whose deletion was admitted to the retention cron", async () => {
    const model = await seedCancelledWorkspace({
      deletionStartedAt: new Date(),
    });

    await expect(choosePlan(PAID_PLAN._id, model)).rejects.toThrow(
      "Workspace is blocked",
    );
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("plans offered to a cancelled workspace", () => {
  it("tells the billing page its owner may choose a plan again", async () => {
    const model = await seedCancelledWorkspace();
    const controller = new SaasTenantPlanController();
    controller.tenantModel = {
      get: async (_id: string) => ({ _id }),
    } as never;
    controller.planModel = GetModel(PlanModel);
    controller.featureModel = { getAll: async () => [] } as never;

    const current = await controller.getCurrentPlan(owner(), {}, model, "en");

    expect(current).toMatchObject({
      status: "cancelled",
      canResubscribe: true,
      canRecoverComplimentary: false,
    });
  });
});
