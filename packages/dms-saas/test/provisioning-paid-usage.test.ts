import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";

const SUBSCRIPTION_START_SECONDS = 1_780_000_000;
const PERIOD_END_SECONDS = 1_782_592_000;

const store = vi.hoisted(() => ({
  plan: undefined as Plan | undefined,
  subscriptions: [] as Partial<TenantSubscription>[],
}));

const stripe = vi.hoisted(() => ({
  customers: { create: vi.fn(), update: vi.fn() },
  paymentMethods: { attach: vi.fn() },
  subscriptions: { create: vi.fn() },
  invoices: { retrieve: vi.fn(), pay: vi.fn() },
}));

const insertNothing = async () => [];

const MODEL_FAKES: Record<string, () => unknown> = {
  PlanModel: () => ({ get: async () => store.plan }),
  TenantModel: () => ({ insert: insertNothing }),
  UserModel: () => ({}),
  TenantBillingInfoModel: () => ({ insert: insertNothing }),
  TenantSubscriptionModel: () => ({
    insert: async (
      rows: Partial<TenantSubscription> | Partial<TenantSubscription>[],
    ) => {
      store.subscriptions.push(...[rows].flat());
      return [];
    },
  }),
};

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }) => MODEL_FAKES[model.name](),
  };
});
vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));
vi.mock("@antelopejs/interface-dms/tenant-ownership", () => ({
  applyTenantOwnership: async () => undefined,
}));
vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async () => undefined,
}));
vi.mock("../src/hooks/tenant-provisioning", () => ({
  emitTenantBeingProvisioned: async () => undefined,
}));
vi.mock("../src/operator-actions/lifecycle-outbox", () => ({
  beginWorkspaceCreation: async () => undefined,
  cancelWorkspaceCreated: async () => undefined,
  deliverWorkspaceCreated: async () => undefined,
  prepareWorkspaceCreated: async () => undefined,
}));
vi.mock("../src/stripe", async () => ({
  ...(await vi.importActual("../src/stripe/payload-shapes")),
  getStripeClient: () => stripe,
  reconcileStripeTaxId: async () => undefined,
  toStripeAddress: () => undefined,
  toTenantBillingAddress: () => null,
}));
vi.mock("../src/workspaces/provisioning-state", () => ({
  beginProvisioningAttempt: async () => undefined,
  recordProvisioningState: async () => undefined,
  reserveTrialIdentities: async () => false,
}));
vi.mock("../src/workspaces/provisioning-rollback", () => ({
  rollbackWorkspaceProvisioning: async () => undefined,
}));

const { provisionWorkspace } = await import("../src/workspaces/provisioning");

function provision(paymentMethodId?: string) {
  return provisionWorkspace({
    userId: "owner",
    payload: {
      workspaceName: "Acme",
      planId: "plan",
      customerType: "individual",
      paymentMethodId,
    },
    stripeCustomerProfile: {
      customerType: "individual",
      email: "owner@example.test",
      fallbackName: "Owner",
    },
    card: { fingerprint: null, billingAddress: undefined },
    handles: { tenantId: "tenant" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.subscriptions = [];
  store.plan = {
    _id: "plan",
    price: 29,
    trialDays: 0,
    paymentProviderRefs: { stripePriceId: "price" },
  } as Plan;
  stripe.customers.create.mockResolvedValue({ id: "customer" });
  stripe.subscriptions.create.mockResolvedValue({
    id: "sub_paid",
    start_date: SUBSCRIPTION_START_SECONDS,
    current_period_end: PERIOD_END_SECONDS,
    latest_invoice: "invoice",
  });
  stripe.invoices.retrieve.mockResolvedValue({ status: "paid" });
});

describe("initial paid usage coverage of a provisioned workspace", () => {
  it("covers a paid workspace from its Stripe subscription's start", async () => {
    await provision("pm_card");
    expect(store.subscriptions).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: "sub_paid",
        isComplimentary: false,
        paidUsagePeriods: [
          {
            stripeSubscriptionId: "sub_paid",
            start: new Date(SUBSCRIPTION_START_SECONDS * 1000),
            end: null,
          },
        ],
      }),
    ]);
  });

  it("leaves a card-less workspace with an empty coverage ledger", async () => {
    store.plan = { ...store.plan, price: 0 } as Plan;
    await provision();
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(store.subscriptions).toEqual([
      expect.objectContaining({
        stripeSubscriptionId: null,
        paidUsagePeriods: [],
      }),
    ]);
  });
});
