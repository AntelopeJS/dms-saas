import {
  GetModel,
  toPlainData,
} from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_SETTINGS_SINGLETON_ID,
  BillingSettingsModel,
  DEFAULT_STRIPE_TAX_CODE as DEFAULT_TAX_CODE,
  type Plan,
  PLAN_LOCALIZED_FIELDS,
  PlanModel,
} from "../src/db";
import { localizePlan } from "../src/plans";
import {
  ensurePlanStripeRefs,
  loadBillablePlan,
  planStripeSyncState,
  reconcilePlansWithStripe,
  startPlanReconciliation,
  syncPlanStripeRefs,
} from "../src/plans/stripe-sync";
import { loadAndValidateTargetPlan } from "../src/routes/tenant/tenant-plan-ops";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";
import {
  editAndSync,
  fake,
  installStripeFake,
  planUpdate,
  plans,
  refsOf,
  seededPlan,
  store,
  syncStored,
  usePlanStripeSync,
} from "./helpers/plan-stripe-sync";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("plan-stripe-sync");
const stripe = useSuiteStripe();
const logs = captureLogs();

usePlanStripeSync(stripe);

describe("syncing a plan written outside dms-saas", () => {
  it("creates its product and price and stores the refs with the synced terms", async () => {
    const plan = await store(seededPlan());

    const synced = await syncPlanStripeRefs(plan, plans);

    const refs = await refsOf(plan._id);
    expect(synced.paymentProviderRefs).toEqual(refs);
    expect(fake.products.get(refs.stripeProductId ?? "")).toMatchObject({
      name: "Hobby",
      tax_code: DEFAULT_TAX_CODE,
    });
    expect(fake.prices.get(refs.stripePriceId ?? "")).toMatchObject({
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

  it("gives Stripe the fallback locale's texts, whatever locale the plan is read in", async () => {
    const plan = PlanModel.fromPlainData({
      ...toPlainData(seededPlan()),
      name: { en: "Hobby", fr: "Loisir" },
      description: { en: "For side projects", fr: "Pour les projets perso" },
    }).localize("*", PLAN_LOCALIZED_FIELDS);
    await GetModel(PlanModel).insert(plan);
    localizePlan(plan, "fr");

    await syncPlanStripeRefs(plan, plans);

    expect((await refsOf(plan._id)).stripeSyncedTerms?.product).toMatchObject({
      name: "Hobby",
      description: "For side projects",
    });
    expect(plan.name).toBe("Loisir");
  });

  it("writes only the refs, never the fields the writer owns", async () => {
    const plan = await store(seededPlan());

    await syncPlanStripeRefs(plan, plans);

    expect(planUpdate).toHaveBeenCalledOnce();
    expect(Object.keys(planUpdate.mock.calls[0]?.[1] ?? {})).toEqual([
      "paymentProviderRefs",
    ]);
  });

  it("costs no Stripe call once the plan is in line", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");
    fake.writes.length = 0;
    planUpdate.mockClear();

    await syncStored("cloud-plan-hobby");

    expect(fake.writes).toEqual([]);
    expect(planUpdate).not.toHaveBeenCalled();
  });

  it("creates a seat-billed price as licensed", async () => {
    await store(seededPlan({ billingMode: "seat" }));

    await syncStored("cloud-plan-hobby");

    const price = fake.prices.get(
      (await refsOf("cloud-plan-hobby")).stripePriceId ?? "",
    );
    expect(price?.recurring).toEqual({
      interval: "month",
      usage_type: "licensed",
    });
  });
});

describe("keeping a synced plan in line", () => {
  it("renames the product in place and keeps the price", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const before = await refsOf("cloud-plan-hobby");
    fake.writes.length = 0;

    await editAndSync("cloud-plan-hobby", { name: "Hobbyist" });

    const after = await refsOf("cloud-plan-hobby");
    expect(after.stripePriceId).toBe(before.stripePriceId);
    expect(fake.writes).toEqual([`products.update:${before.stripeProductId}`]);
    expect(fake.products.get(before.stripeProductId ?? "")?.name).toBe(
      "Hobbyist",
    );
  });

  it("creates a new price when the amount changes and archives the old one", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const oldPriceId = (await refsOf("cloud-plan-hobby")).stripePriceId ?? "";

    await editAndSync("cloud-plan-hobby", { price: 6 });

    const newPriceId = (await refsOf("cloud-plan-hobby")).stripePriceId ?? "";
    expect(newPriceId).not.toBe(oldPriceId);
    expect(fake.prices.get(newPriceId)?.unit_amount).toBe(600);
    expect(fake.prices.get(oldPriceId)?.active).toBe(false);
  });

  it("creates a new price when the currency changes", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");

    await editAndSync("cloud-plan-hobby", { currency: "USD" });

    const price = fake.prices.get(
      (await refsOf("cloud-plan-hobby")).stripePriceId ?? "",
    );
    expect(price?.currency).toBe("usd");
    expect(fake.prices.size).toBe(2);
  });

  it("creates a fresh price when the plan returns to earlier terms", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const firstPriceId = (await refsOf("cloud-plan-hobby")).stripePriceId;
    await editAndSync("cloud-plan-hobby", { price: 6 });

    await editAndSync("cloud-plan-hobby", { price: 5 });

    const current = fake.prices.get(
      (await refsOf("cloud-plan-hobby")).stripePriceId ?? "",
    );
    expect(current?.id).not.toBe(firstPriceId);
    expect(current).toMatchObject({ active: true, unit_amount: 500 });
  });

  it("follows a tax code change on the product", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");
    const before = await refsOf("cloud-plan-hobby");
    await GetModel(BillingSettingsModel).insert({
      _id: BILLING_SETTINGS_SINGLETON_ID,
      stripeTaxCode: "txcd_99999999",
    });

    await syncStored("cloud-plan-hobby");

    expect(fake.products.get(before.stripeProductId ?? "")?.tax_code).toBe(
      "txcd_99999999",
    );
    expect((await refsOf("cloud-plan-hobby")).stripePriceId).toBe(
      before.stripePriceId,
    );
  });
});

describe("plans synced before the terms were recorded", () => {
  async function legacyPlan(amount: number): Promise<Plan> {
    const product = fromPartial<Stripe.Product>({
      id: "prod_legacy",
      name: "Hobby",
      description: "For side projects",
      tax_code: DEFAULT_TAX_CODE,
    });
    fake.products.set(product.id, product);
    fake.prices.set(
      "price_legacy",
      fromPartial<Stripe.Price>({
        id: "price_legacy",
        product: product.id,
        active: true,
        unit_amount: amount,
        currency: "eur",
        recurring: { interval: "month" },
        metadata: { planId: "cloud-plan-hobby", billingMode: "flat" },
      }),
    );
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
    const plan = await legacyPlan(500);

    await syncPlanStripeRefs(plan, plans);

    expect(fake.writes).toEqual([]);
    expect(await refsOf(plan._id)).toMatchObject({
      stripePriceId: "price_legacy",
      stripeSyncedTerms: { price: { unitAmount: 500 } },
    });
  });

  it("replaces a price that no longer matches", async () => {
    const plan = await legacyPlan(400);

    await syncPlanStripeRefs(plan, plans);

    expect((await refsOf(plan._id)).stripePriceId).not.toBe("price_legacy");
    expect(fake.prices.get("price_legacy")?.active).toBe(false);
  });
});

describe("plans that stay off Stripe", () => {
  it("leaves a plan priced 0 alone", async () => {
    const plan = await store(seededPlan({ _id: "cloud-plan-free", price: 0 }));

    await expect(syncPlanStripeRefs(plan, plans)).resolves.toBe(plan);

    expect(fake.writes).toEqual([]);
  });

  it("keeps a plan priced 0 in line once it is linked to a Stripe price", async () => {
    await store(seededPlan());
    await syncStored("cloud-plan-hobby");

    await editAndSync("cloud-plan-hobby", { price: 0 });

    const price = fake.prices.get(
      (await refsOf("cloud-plan-hobby")).stripePriceId ?? "",
    );
    expect(price?.unit_amount).toBe(0);
  });

  it("skips every plan while Stripe is not configured", async () => {
    const plan = await store(seededPlan());

    await withUnconfiguredStripe(stripe, async (unconfigured) => {
      installStripeFake(unconfigured.write);

      await expect(syncPlanStripeRefs(plan, plans)).resolves.toBe(plan);
      await reconcilePlansWithStripe();
    });

    expect(fake.writes).toEqual([]);
    expect(logs.at("WARN")).toEqual([
      [expect.stringContaining("Stripe not configured")],
    ]);
  });

  it("reports a paid plan unsellable while Stripe is not configured, a free one off Stripe", async () => {
    await withUnconfiguredStripe(stripe, async () => {
      await expect(planStripeSyncState(seededPlan())).resolves.toBe(
        "not_configured",
      );
      await expect(
        planStripeSyncState(seededPlan({ _id: "cloud-plan-free", price: 0 })),
      ).resolves.toBe("off_stripe");
    });
  });

  it("skips a plan without a supported interval", async () => {
    const plan = await store(Object.assign(seededPlan(), { interval: "week" }));

    await expect(syncPlanStripeRefs(plan, plans)).resolves.toBe(plan);

    expect(fake.writes).toEqual([]);
  });
});

describe("concurrent syncs", () => {
  it("shares one sync between concurrent callers of one process", async () => {
    const plan = await store(seededPlan());

    await Promise.all([
      syncPlanStripeRefs(plan, plans),
      syncPlanStripeRefs(plan, plans),
    ]);

    expect(fake.products.size).toBe(1);
    expect(fake.prices.size).toBe(1);
    expect(planUpdate).toHaveBeenCalledOnce();
  });

  it("lands two replicas syncing the same plan on the same Stripe objects", async () => {
    const plan = await store(seededPlan());
    const otherReplicaCopy = planRow(toPlainData(plan));

    await syncPlanStripeRefs(plan, plans);
    await syncPlanStripeRefs(otherReplicaCopy, plans);

    expect(fake.products.size).toBe(1);
    expect(fake.prices.size).toBe(1);
  });

  it("keeps two environments sharing a Stripe account apart", async () => {
    const plan = await store(seededPlan());
    await syncPlanStripeRefs(plan, plans);

    await syncPlanStripeRefs(
      planRow({
        ...toPlainData(plan),
        createdAt: new Date("2026-09-02T00:00:00Z"),
      }),
      plans,
    );

    expect(fake.products.size).toBe(2);
  });
});

describe("reconciling the catalogue", () => {
  it("syncs every active plan and carries on past a failure", async () => {
    await store(seededPlan({ _id: "cloud-plan-broken", slug: "broken" }));
    await store(seededPlan({ _id: "cloud-plan-pro", slug: "pro", price: 20 }));
    await store(seededPlan({ _id: "cloud-plan-free", slug: "free", price: 0 }));
    await store(
      seededPlan({ _id: "cloud-plan-old", slug: "old", isActive: false }),
    );
    fake.failingPlanIds.add("cloud-plan-broken");

    await reconcilePlansWithStripe();

    expect((await refsOf("cloud-plan-pro")).stripePriceId).toBeDefined();
    expect((await refsOf("cloud-plan-broken")).stripePriceId).toBeUndefined();
    expect((await refsOf("cloud-plan-free")).stripePriceId).toBeUndefined();
    expect((await refsOf("cloud-plan-old")).stripePriceId).toBeUndefined();
    expect(logs.at("ERROR")).toContainEqual([
      expect.stringContaining("cloud-plan-broken"),
      expect.any(Error),
    ]);
  });

  it("starts in the background and logs a failure instead of throwing", async () => {
    vi.spyOn(plans, "findActiveNotDeleted").mockRejectedValueOnce(
      new Error("Schema not found for 'dms-core'"),
    );

    expect(startPlanReconciliation()).toBeUndefined();

    await vi.waitFor(() => {
      expect(logs.at("ERROR")).toContainEqual([
        "[dms-saas:plans] Stripe plan reconciliation failed",
        expect.any(Error),
      ]);
    });
  });

  it("returns the plan as stored when the sync fails", async () => {
    const plan = await store(seededPlan());
    fake.failingPlanIds.add(plan._id);

    await expect(ensurePlanStripeRefs(plan, plans)).resolves.toBe(plan);
  });

  it("loads a billable plan with its Stripe refs", async () => {
    await store(seededPlan());

    const plan = await loadBillablePlan("cloud-plan-hobby");

    expect(plan?.paymentProviderRefs.stripePriceId).toBeDefined();
    await expect(loadBillablePlan("missing")).resolves.toBeUndefined();
  });
});

describe("choosing a plan written outside dms-saas", () => {
  it("syncs it on the spot instead of refusing it as not synced", async () => {
    await store(seededPlan());

    const plan = await loadAndValidateTargetPlan(
      plans,
      "cloud-plan-hobby",
      "individual",
    );

    expect(plan.paymentProviderRefs.stripePriceId).toBeDefined();
    expect((await refsOf("cloud-plan-hobby")).stripePriceId).toBe(
      plan.paymentProviderRefs.stripePriceId,
    );
  });

  it("still refuses it when Stripe cannot sync it", async () => {
    await store(seededPlan());
    fake.failingPlanIds.add("cloud-plan-hobby");

    await expect(
      loadAndValidateTargetPlan(plans, "cloud-plan-hobby", "individual"),
    ).rejects.toMatchObject({
      status: 400,
      body: "saas.errors.plan.not_synced_with_stripe",
    });
  });
});
