import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, TenantSubscription } from "../src/db";

const store = vi.hoisted(() => ({
  plans: [] as Plan[],
  tenants: [] as string[],
  subscriptions: new Map<string, TenantSubscription[]>(),
  recomputed: [] as string[],
  warnings: [] as string[],
  configuredSlug: undefined as string | undefined,
}));

function subscriptionModel(tenantId: string) {
  const rows = () => store.subscriptions.get(tenantId) ?? [];
  return {
    findOne: async () => rows()[0],
    insert: async (inserted: TenantSubscription[]) => {
      store.subscriptions.set(tenantId, [...rows(), ...inserted]);
      return inserted.map((row) => row._id);
    },
  };
}

const MODEL_FAKES: Record<string, (tenantId?: string) => unknown> = {
  PlanModel: () => ({ findActiveNotDeleted: async () => store.plans }),
  TenantModel: () => ({
    table: {
      pluck: () => ({
        run: async () => store.tenants.map((_id) => ({ _id })),
      }),
    },
  }),
  TenantSubscriptionModel: (tenantId) => subscriptionModel(tenantId ?? ""),
};

vi.mock("@antelopejs/interface-database-decorators", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@antelopejs/interface-database-decorators")
    >();
  return {
    ...actual,
    GetModel: (model: { name: string }, tenantId?: string) =>
      MODEL_FAKES[model.name](tenantId),
  };
});

vi.mock("@antelopejs/interface-dms/tenant-lifecycle", () => ({
  runTenantLifecycleOperation: async (
    _tenantId: string,
    work: () => Promise<unknown>,
  ) => work(),
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: {
    Error: () => undefined,
    Info: () => undefined,
    Warn: (message: string) => store.warnings.push(message),
  },
}));

vi.mock("../src/billing-state", () => ({
  recomputeTenantBillingState: async (tenantId: string) => {
    store.recomputed.push(tenantId);
  },
}));

vi.mock("../src/config", () => ({
  getDefaultPlanSlug: () => store.configuredSlug,
}));

const {
  backfillDefaultSubscriptions,
  ensureDefaultSubscription,
  resolveDefaultPlan,
  selectDefaultPlan,
} = await import("../src/workspaces/default-plan");

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "plan",
    slug: "plan",
    name: "Plan",
    price: 0,
    order: 0,
    audience: "any",
    isActive: true,
    isDeleted: false,
    ...overrides,
  } as Plan;
}

const FREE = plan({ _id: "free", slug: "free", order: 1 });
const STARTER = plan({ _id: "starter", slug: "starter", order: 2 });
const PAID = plan({ _id: "pro", slug: "pro", price: 20, order: 0 });
const BUSINESS_FREE = plan({
  _id: "biz",
  slug: "biz",
  order: 0,
  audience: "business",
});

beforeEach(async () => {
  // Re-arms the once-per-outage warning latch between tests.
  store.plans = [FREE];
  await resolveDefaultPlan();
  store.plans = [STARTER, PAID, BUSINESS_FREE, FREE];
  store.tenants = [];
  store.subscriptions.clear();
  store.recomputed = [];
  store.warnings = [];
  store.configuredSlug = undefined;
});

describe("default plan selection", () => {
  it("picks the lowest-ordered free plan open to individuals", () => {
    expect(selectDefaultPlan(store.plans)?._id).toBe("free");
  });

  it("honours a configured slug naming a usable free plan", () => {
    expect(selectDefaultPlan(store.plans, "starter")?._id).toBe("starter");
  });

  it("falls back with a warning when the configured slug is not a free plan", () => {
    expect(selectDefaultPlan(store.plans, "pro")?._id).toBe("free");
    expect(store.warnings).toHaveLength(1);
  });

  it("ignores inactive and deleted plans", () => {
    const plans = [
      plan({ _id: "off", order: 0, isActive: false }),
      plan({ _id: "gone", order: 0, isDeleted: true }),
      FREE,
    ];
    expect(selectDefaultPlan(plans)?._id).toBe("free");
  });

  it("returns null when the catalogue has no free plan", () => {
    expect(selectDefaultPlan([PAID, BUSINESS_FREE])).toBeNull();
  });
});

describe("default subscription assignment", () => {
  it("attaches an active, card-less subscription on the default plan", async () => {
    await expect(ensureDefaultSubscription("ws1")).resolves.toBe(true);

    expect(store.subscriptions.get("ws1")).toEqual([
      expect.objectContaining({
        _id: "ws1",
        planId: "free",
        status: "active",
        stripeSubscriptionId: null,
        isComplimentary: false,
      }),
    ]);
    expect(store.recomputed).toEqual(["ws1"]);
  });

  it("leaves a workspace that already holds a subscription untouched", async () => {
    const existing = {
      _id: "ws1",
      planId: "pro",
      status: "past_due",
    } as TenantSubscription;
    store.subscriptions.set("ws1", [existing]);

    await expect(ensureDefaultSubscription("ws1")).resolves.toBe(false);

    expect(store.subscriptions.get("ws1")).toEqual([existing]);
    expect(store.recomputed).toEqual([]);
  });

  it("attaches nothing when no default plan exists", async () => {
    store.plans = [PAID];

    await expect(ensureDefaultSubscription("ws1")).resolves.toBe(false);

    expect(store.subscriptions.has("ws1")).toBe(false);
  });
});

describe("default subscription backfill", () => {
  it("covers every plan-less workspace, the default tenant included", async () => {
    store.tenants = ["default", "ws1", "ws2"];
    store.subscriptions.set("ws2", [
      { _id: "ws2", planId: "pro", status: "active" } as TenantSubscription,
    ]);

    await expect(backfillDefaultSubscriptions()).resolves.toBe(2);

    expect(store.subscriptions.get("default")?.[0]?.planId).toBe("free");
    expect(store.subscriptions.get("ws1")?.[0]?.planId).toBe("free");
    expect(store.subscriptions.get("ws2")?.[0]?.planId).toBe("pro");
  });

  it("is idempotent", async () => {
    store.tenants = ["default", "ws1"];

    await backfillDefaultSubscriptions();
    await expect(backfillDefaultSubscriptions()).resolves.toBe(0);

    expect(store.subscriptions.get("default")).toHaveLength(1);
    expect(store.subscriptions.get("ws1")).toHaveLength(1);
  });

  it("does nothing but log, once, while the catalogue has no free plan", async () => {
    store.tenants = ["default"];
    store.plans = [PAID];

    await expect(backfillDefaultSubscriptions()).resolves.toBe(0);
    await backfillDefaultSubscriptions();

    expect(store.subscriptions.size).toBe(0);
    expect(store.warnings).toHaveLength(1);
  });
});
