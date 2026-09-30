import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STRIPE_TAX_CODE as DEFAULT_TAX_CODE,
  type Plan,
  type PlanModel,
  type PlanProviderRefs,
} from "../src/db";

interface FakeProduct {
  id: string;
  name: string;
  description: string | null;
  tax_code: string;
  deleted?: boolean;
}

interface FakePrice {
  id: string;
  product: string;
  active: boolean;
  unit_amount: number;
  currency: string;
  recurring: { interval: string; usage_type?: string };
  metadata: Record<string, string>;
}

interface IdempotencyOptions {
  idempotencyKey?: string;
}

interface RetrieveOptions {
  expand?: string[];
}

const fake = vi.hoisted(() => ({
  isConfigured: true,
  failingPlanIds: new Set<string>(),
  products: new Map<string, FakeProduct>(),
  prices: new Map<string, FakePrice>(),
  responsesByKey: new Map<string, unknown>(),
  writes: [] as string[],
  plans: new Map<string, Plan>(),
  planUpdates: [] as unknown[],
  logs: [] as string[],
}));

/**
 * Stripe's idempotency contract: a key already seen returns the object the
 * first request created, whichever replica sends it.
 */
function idempotent<T>(
  options: IdempotencyOptions | undefined,
  create: () => T,
) {
  const key = options?.idempotencyKey;
  if (key && fake.responsesByKey.has(key)) {
    return fake.responsesByKey.get(key) as T;
  }
  const created = create();
  if (key) fake.responsesByKey.set(key, created);
  return created;
}

function assertNotFailing(metadata: Record<string, string> | undefined) {
  if (metadata?.planId && fake.failingPlanIds.has(metadata.planId)) {
    throw new Error("Stripe unavailable");
  }
}

const stripeClient = {
  products: {
    create: async (
      params: Omit<FakeProduct, "id"> & { metadata: Record<string, string> },
      options?: IdempotencyOptions,
    ) => {
      assertNotFailing(params.metadata);
      return idempotent(options, () => {
        const product = {
          id: `prod_${fake.products.size + 1}`,
          name: params.name,
          description: params.description ?? null,
          tax_code: params.tax_code,
        };
        fake.products.set(product.id, product);
        fake.writes.push(`products.create:${product.id}`);
        return product;
      });
    },
    update: async (id: string, params: Partial<FakeProduct>) => {
      const product = fake.products.get(id) as FakeProduct;
      Object.assign(product, params, {
        description: params.description || null,
      });
      fake.writes.push(`products.update:${id}`);
      return product;
    },
  },
  prices: {
    create: async (
      params: Omit<FakePrice, "id" | "active">,
      options?: IdempotencyOptions,
    ) => {
      assertNotFailing(params.metadata);
      return idempotent(options, () => {
        const price = {
          ...params,
          id: `price_${fake.prices.size + 1}`,
          active: true,
        };
        fake.prices.set(price.id, price);
        fake.writes.push(`prices.create:${price.id}`);
        return price;
      });
    },
    update: async (id: string, params: Partial<FakePrice>) => {
      const price = fake.prices.get(id) as FakePrice;
      Object.assign(price, params);
      fake.writes.push(`prices.update:${id}`);
      return price;
    },
    retrieve: async (id: string, options?: RetrieveOptions) => {
      const price = fake.prices.get(id);
      if (!price)
        throw Object.assign(new Error("No such price"), {
          code: "resource_missing",
        });
      const isProductExpanded = options?.expand?.includes("product");
      return isProductExpanded
        ? { ...price, product: fake.products.get(price.product) }
        : price;
    },
  },
};

vi.mock("../src/stripe/client", () => ({
  isStripeConfigured: () => fake.isConfigured,
  getStripeClient: () => stripeClient,
}));

const planStore = {
  get: async (id: string) => fake.plans.get(id),
  findActiveNotDeleted: async () =>
    [...fake.plans.values()].filter((plan) => plan.isActive && !plan.isDeleted),
  update: async (id: string, patch: Partial<Plan>) => {
    fake.planUpdates.push(patch);
    const plan = fake.plans.get(id) as Plan;
    fake.plans.set(id, { ...plan, ...patch } as Plan);
    return 1;
  },
};

const MODEL_FAKES: Record<string, () => unknown> = {
  BillingSettingsModel: () => ({ get: async () => undefined }),
  PlanModel: () => planStore,
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

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: {
    Info: (message: string) => fake.logs.push(`info:${message}`),
    Warn: (message: string) => fake.logs.push(`warn:${message}`),
    Error: (message: string) => fake.logs.push(`error:${message}`),
  },
}));

import {
  ensurePlanStripeRefs,
  loadBillablePlan,
  reconcilePlansWithStripe,
  syncPlanStripeRefs,
} from "../src/plans/stripe-sync";
import { loadAndValidateTargetPlan } from "../src/routes/tenant/tenant-plan-ops";

function seededPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    _id: "cloud-plan-hobby",
    name: "Hobby",
    slug: "hobby",
    description: "For side projects",
    audience: "any",
    price: 5,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    features: [],
    permissions: [],
    inheritsFromPlanId: null,
    trialDays: 0,
    maxMembers: 3,
    isPublic: true,
    paymentProviderRefs: {},
    borderColor: null,
    borderLabel: null,
    order: 20,
    isActive: true,
    isDeleted: false,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  } as Plan;
}

function store(plan: Plan): Plan {
  fake.plans.set(plan._id, plan);
  return plan;
}

function refsOf(planId: string): PlanProviderRefs {
  return fake.plans.get(planId)?.paymentProviderRefs ?? {};
}

async function syncStored(planId: string): Promise<Plan> {
  return syncPlanStripeRefs(fake.plans.get(planId) as Plan);
}

async function editAndSync(
  planId: string,
  patch: Partial<Plan>,
): Promise<Plan> {
  const plan = fake.plans.get(planId) as Plan;
  store({ ...plan, ...patch } as Plan);
  return syncStored(planId);
}

beforeEach(() => {
  fake.isConfigured = true;
  fake.failingPlanIds.clear();
  fake.products.clear();
  fake.prices.clear();
  fake.responsesByKey.clear();
  fake.writes.length = 0;
  fake.plans.clear();
  fake.planUpdates.length = 0;
  fake.logs.length = 0;
});

describe("syncing a plan written outside dms-saas", () => {
  it("creates its product and price and stores the refs with the synced terms", async () => {
    const plan = store(seededPlan());

    const synced = await syncPlanStripeRefs(plan);

    const refs = refsOf(plan._id);
    expect(synced.paymentProviderRefs).toEqual(refs);
    expect(fake.products.get(refs.stripeProductId as string)).toMatchObject({
      name: "Hobby",
      tax_code: DEFAULT_TAX_CODE,
    });
    expect(fake.prices.get(refs.stripePriceId as string)).toMatchObject({
      unit_amount: 500,
      currency: "eur",
      recurring: { interval: "month" },
      metadata: { planId: plan._id, billingMode: "flat" },
    });
    expect(refs.stripeSyncedTerms).toEqual({
      product: {
        name: "Hobby",
        description: "For side projects",
        taxCode: DEFAULT_TAX_CODE,
      },
      price: {
        unitAmount: 500,
        currency: "eur",
        interval: "month",
        billingMode: "flat",
      },
    });
  });

  it("gives Stripe no description for an i18n key it could not show", async () => {
    const plan = store(
      seededPlan({ description: "$cloud.plans.hobby.description" }),
    );

    await syncPlanStripeRefs(plan);

    expect(refsOf(plan._id).stripeSyncedTerms?.product.description).toBe("");
  });

  it("writes only the refs, never the fields the writer owns", async () => {
    const plan = store(seededPlan());

    await syncPlanStripeRefs(plan);

    expect(fake.planUpdates).toHaveLength(1);
    expect(Object.keys(fake.planUpdates[0] as object)).toEqual([
      "paymentProviderRefs",
    ]);
  });

  it("costs no Stripe call once the plan is in line", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");
    fake.writes.length = 0;
    fake.planUpdates.length = 0;

    await syncStored("cloud-plan-hobby");

    expect(fake.writes).toEqual([]);
    expect(fake.planUpdates).toEqual([]);
  });

  it("creates a seat-billed price as licensed", async () => {
    store(seededPlan({ billingMode: "seat" }));

    await syncStored("cloud-plan-hobby");

    const price = fake.prices.get(
      refsOf("cloud-plan-hobby").stripePriceId as string,
    );
    expect(price?.recurring).toEqual({
      interval: "month",
      usage_type: "licensed",
    });
  });
});

describe("keeping a synced plan in line", () => {
  it("renames the product in place and keeps the price", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const before = refsOf("cloud-plan-hobby");
    fake.writes.length = 0;

    await editAndSync("cloud-plan-hobby", { name: "Hobbyist" });

    const after = refsOf("cloud-plan-hobby");
    expect(after.stripePriceId).toBe(before.stripePriceId);
    expect(fake.writes).toEqual([`products.update:${before.stripeProductId}`]);
    expect(fake.products.get(before.stripeProductId as string)?.name).toBe(
      "Hobbyist",
    );
  });

  it("creates a new price when the amount changes and archives the old one", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const oldPriceId = refsOf("cloud-plan-hobby").stripePriceId as string;

    await editAndSync("cloud-plan-hobby", { price: 6 });

    const newPriceId = refsOf("cloud-plan-hobby").stripePriceId as string;
    expect(newPriceId).not.toBe(oldPriceId);
    expect(fake.prices.get(newPriceId)?.unit_amount).toBe(600);
    expect(fake.prices.get(oldPriceId)?.active).toBe(false);
  });

  it("creates a new price when the currency changes", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");

    await editAndSync("cloud-plan-hobby", { currency: "USD" });

    const price = fake.prices.get(
      refsOf("cloud-plan-hobby").stripePriceId as string,
    );
    expect(price?.currency).toBe("usd");
    expect(fake.prices.size).toBe(2);
  });

  it("creates a fresh price when the plan returns to earlier terms", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const firstPriceId = refsOf("cloud-plan-hobby").stripePriceId;
    await editAndSync("cloud-plan-hobby", { price: 6 });

    await editAndSync("cloud-plan-hobby", { price: 5 });

    const current = fake.prices.get(
      refsOf("cloud-plan-hobby").stripePriceId as string,
    );
    expect(current?.id).not.toBe(firstPriceId);
    expect(current).toMatchObject({ active: true, unit_amount: 500 });
  });

  it("follows a tax code change on the product", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const before = refsOf("cloud-plan-hobby");
    MODEL_FAKES.BillingSettingsModel = () => ({
      get: async () => ({ stripeTaxCode: "txcd_99999999" }),
    });

    try {
      await syncStored("cloud-plan-hobby");
    } finally {
      MODEL_FAKES.BillingSettingsModel = () => ({ get: async () => undefined });
    }

    expect(fake.products.get(before.stripeProductId as string)?.tax_code).toBe(
      "txcd_99999999",
    );
    expect(refsOf("cloud-plan-hobby").stripePriceId).toBe(before.stripePriceId);
  });
});

describe("plans synced before the terms were recorded", () => {
  function legacyPlan(amount: number): Plan {
    const product = {
      id: "prod_legacy",
      name: "Hobby",
      description: "For side projects",
      tax_code: DEFAULT_TAX_CODE,
    };
    fake.products.set(product.id, product);
    fake.prices.set("price_legacy", {
      id: "price_legacy",
      product: product.id,
      active: true,
      unit_amount: amount,
      currency: "eur",
      recurring: { interval: "month" },
      metadata: { planId: "cloud-plan-hobby", billingMode: "flat" },
    });
    return store(
      seededPlan({
        paymentProviderRefs: {
          stripeProductId: "prod_legacy",
          stripePriceId: "price_legacy",
        },
      }),
    );
  }

  it("keeps a price that still matches and records its terms", async () => {
    const plan = legacyPlan(500);

    await syncPlanStripeRefs(plan);

    expect(fake.writes).toEqual([]);
    expect(refsOf(plan._id)).toMatchObject({
      stripePriceId: "price_legacy",
      stripeSyncedTerms: { price: { unitAmount: 500 } },
    });
  });

  it("replaces a price that no longer matches", async () => {
    const plan = legacyPlan(400);

    await syncPlanStripeRefs(plan);

    expect(refsOf(plan._id).stripePriceId).not.toBe("price_legacy");
    expect(fake.prices.get("price_legacy")?.active).toBe(false);
  });
});

describe("plans that stay off Stripe", () => {
  it("leaves a plan priced 0 alone", async () => {
    const plan = store(seededPlan({ _id: "cloud-plan-free", price: 0 }));

    await expect(syncPlanStripeRefs(plan)).resolves.toBe(plan);

    expect(fake.writes).toEqual([]);
  });

  it("keeps a plan priced 0 in line once it is linked to a Stripe price", async () => {
    store(seededPlan());
    await syncStored("cloud-plan-hobby");

    await editAndSync("cloud-plan-hobby", { price: 0 });

    const price = fake.prices.get(
      refsOf("cloud-plan-hobby").stripePriceId as string,
    );
    expect(price?.unit_amount).toBe(0);
  });

  it("skips every plan while Stripe is not configured", async () => {
    fake.isConfigured = false;
    const plan = store(seededPlan());

    await expect(syncPlanStripeRefs(plan)).resolves.toBe(plan);
    await reconcilePlansWithStripe();

    expect(fake.writes).toEqual([]);
    expect(fake.logs.some((log) => log.startsWith("warn:"))).toBe(true);
  });

  it("skips a plan without a supported interval", async () => {
    const plan = store(seededPlan({ interval: "week" as Plan["interval"] }));

    await expect(syncPlanStripeRefs(plan)).resolves.toBe(plan);

    expect(fake.writes).toEqual([]);
  });
});

describe("concurrent syncs", () => {
  it("shares one sync between concurrent callers of one process", async () => {
    const plan = store(seededPlan());

    await Promise.all([syncPlanStripeRefs(plan), syncPlanStripeRefs(plan)]);

    expect(fake.products.size).toBe(1);
    expect(fake.prices.size).toBe(1);
    expect(fake.planUpdates).toHaveLength(1);
  });

  it("lands two replicas syncing the same plan on the same Stripe objects", async () => {
    const plan = store(seededPlan());
    const otherReplicaCopy = { ...plan } as Plan;

    await syncPlanStripeRefs(plan);
    await syncPlanStripeRefs(otherReplicaCopy);

    expect(fake.products.size).toBe(1);
    expect(fake.prices.size).toBe(1);
  });

  it("keeps two environments sharing a Stripe account apart", async () => {
    const plan = store(seededPlan());
    await syncPlanStripeRefs(plan);

    await syncPlanStripeRefs({
      ...plan,
      createdAt: new Date("2026-09-02T00:00:00Z"),
    } as Plan);

    expect(fake.products.size).toBe(2);
  });
});

describe("reconciling the catalogue", () => {
  it("syncs every active plan and carries on past a failure", async () => {
    store(seededPlan({ _id: "cloud-plan-broken", slug: "broken" }));
    store(seededPlan({ _id: "cloud-plan-pro", slug: "pro", price: 20 }));
    store(seededPlan({ _id: "cloud-plan-free", slug: "free", price: 0 }));
    store(seededPlan({ _id: "cloud-plan-old", slug: "old", isActive: false }));
    fake.failingPlanIds.add("cloud-plan-broken");

    await reconcilePlansWithStripe();

    expect(refsOf("cloud-plan-pro").stripePriceId).toBeDefined();
    expect(refsOf("cloud-plan-broken").stripePriceId).toBeUndefined();
    expect(refsOf("cloud-plan-free").stripePriceId).toBeUndefined();
    expect(refsOf("cloud-plan-old").stripePriceId).toBeUndefined();
    expect(fake.logs.some((log) => log.includes("cloud-plan-broken"))).toBe(
      true,
    );
  });

  it("returns the plan as stored when the sync fails", async () => {
    const plan = store(seededPlan());
    fake.failingPlanIds.add(plan._id);

    await expect(ensurePlanStripeRefs(plan)).resolves.toBe(plan);
  });

  it("loads a billable plan with its Stripe refs", async () => {
    store(seededPlan());

    const plan = await loadBillablePlan("cloud-plan-hobby");

    expect(plan?.paymentProviderRefs.stripePriceId).toBeDefined();
    await expect(loadBillablePlan("missing")).resolves.toBeUndefined();
  });
});

describe("choosing a plan written outside dms-saas", () => {
  it("syncs it on the spot instead of refusing it as not synced", async () => {
    store(seededPlan());

    const plan = await loadAndValidateTargetPlan(
      planStore as unknown as PlanModel,
      "cloud-plan-hobby",
      "individual",
    );

    expect(plan.paymentProviderRefs.stripePriceId).toBeDefined();
    expect(refsOf("cloud-plan-hobby").stripePriceId).toBe(
      plan.paymentProviderRefs.stripePriceId,
    );
  });

  it("still refuses it when Stripe cannot sync it", async () => {
    store(seededPlan());
    fake.failingPlanIds.add("cloud-plan-hobby");

    await expect(
      loadAndValidateTargetPlan(
        planStore as unknown as PlanModel,
        "cloud-plan-hobby",
        "individual",
      ),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.plan.not_synced_with_stripe",
    });
  });
});
