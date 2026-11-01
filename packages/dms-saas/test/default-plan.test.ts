import { fromPartial } from "@total-typescript/shoehorn";
import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { TenantModel } from "@antelopejs/interface-dms/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type Plan,
  PlanModel,
  TenantBillingStateModel,
  TenantSubscriptionModel,
} from "../src/db";
import {
  ensureDefaultSubscription,
  resolveDefaultPlan,
  selectDefaultPlan,
  withDefaultPlanChange,
} from "../src/workspaces/default-plan";
import { captureLogs } from "./helpers/logging";
import { useMongoDatabase } from "./helpers/mongo";

useMongoDatabase("default-plan");
const logs = captureLogs();

function plan(overrides: Partial<Plan>): Plan {
  return fromPartial<Plan>({
    _id: "plan",
    slug: "plan",
    name: "Plan",
    price: 0,
    order: 0,
    audience: "any",
    isActive: true,
    isDeleted: false,
    ...overrides,
  });
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
const CATALOGUE = [STARTER, PAID, BUSINESS_FREE, FREE];

/** A table the suite empties between tests, read and written by id. */
interface ClearableModel {
  getAll(): PromiseLike<{ _id: string }[]>;
  delete(id: string): Promise<number>;
}

async function clear(model: ClearableModel): Promise<void> {
  for (const { _id } of await model.getAll()) await model.delete(_id);
}

/** Replaces the plan catalogue with `plans`. */
async function publishCatalogue(plans: Plan[]): Promise<void> {
  await clear(GetModel(PlanModel));
  await GetModel(PlanModel).insert(plans);
}

async function addTenants(...tenantIds: string[]): Promise<void> {
  const now = new Date();
  await GetModel(TenantModel).insert(
    tenantIds.map((_id) => ({
      _id,
      name: _id,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

async function subscriptionsOf(tenantId: string) {
  return GetModel(TenantSubscriptionModel, tenantId).getAll();
}

/** The workspaces a billing state was published for. */
async function recomputedTenants(): Promise<string[]> {
  const states = await GetModel(TenantBillingStateModel).getAll();
  return states.map((state) => state._id);
}

/**
 * Starts every test from {@link CATALOGUE}, no workspace and no billing
 * state. Reading the default plan of a catalogue that has one re-arms the
 * once-per-outage warning latch.
 */
beforeEach(async () => {
  await publishCatalogue(CATALOGUE);
  await resolveDefaultPlan();
  await clear(GetModel(TenantModel));
  await clear(GetModel(TenantBillingStateModel));
});

describe("default plan selection", () => {
  it("picks the lowest-ordered free plan open to individuals", () => {
    expect(selectDefaultPlan(CATALOGUE)?._id).toBe("free");
  });

  it("honours a configured slug naming a usable free plan", () => {
    expect(selectDefaultPlan(CATALOGUE, "starter")?._id).toBe("starter");
  });

  it("falls back with a warning when the configured slug is not a free plan", () => {
    expect(selectDefaultPlan(CATALOGUE, "pro")?._id).toBe("free");
    expect(logs.at("WARN")).toEqual([
      [expect.stringContaining('defaultPlanSlug "pro"')],
    ]);
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
    const tenantId = randomUUID();

    await expect(ensureDefaultSubscription(tenantId)).resolves.toBe(true);

    expect(await subscriptionsOf(tenantId)).toEqual([
      expect.objectContaining({
        _id: tenantId,
        planId: "free",
        status: "active",
        stripeSubscriptionId: null,
        isComplimentary: false,
        paidUsagePeriods: [],
      }),
    ]);
    expect(await recomputedTenants()).toEqual([tenantId]);
  });

  it("leaves a workspace that already holds a subscription untouched", async () => {
    const tenantId = randomUUID();
    await GetModel(TenantSubscriptionModel, tenantId).insert({
      _id: tenantId,
      planId: "pro",
      status: "past_due",
    });
    const existing = await subscriptionsOf(tenantId);

    await expect(ensureDefaultSubscription(tenantId)).resolves.toBe(false);

    expect(await subscriptionsOf(tenantId)).toEqual(existing);
    expect(await recomputedTenants()).toEqual([]);
  });

  it("attaches nothing when no default plan exists", async () => {
    const tenantId = randomUUID();
    await publishCatalogue([PAID]);

    await expect(ensureDefaultSubscription(tenantId)).resolves.toBe(false);

    expect(await subscriptionsOf(tenantId)).toEqual([]);
  });
});

describe("catalogue writes that change the default plan", () => {
  it("attach the new default, once, to every plan-less workspace", async () => {
    const [planLess, paying] = [randomUUID(), randomUUID()];
    await addTenants(DEFAULT_TENANT_ID, planLess, paying);
    await publishCatalogue([PAID]);
    await GetModel(TenantSubscriptionModel, paying).insert({
      _id: paying,
      planId: "pro",
      status: "active",
    });

    await withDefaultPlanChange(async () => {
      await GetModel(PlanModel).insert(FREE);
    });

    expect(await subscriptionsOf(DEFAULT_TENANT_ID)).toEqual([
      expect.objectContaining({ planId: "free" }),
    ]);
    expect(await subscriptionsOf(planLess)).toEqual([
      expect.objectContaining({ planId: "free" }),
    ]);
    expect(await subscriptionsOf(paying)).toEqual([
      expect.objectContaining({ planId: "pro" }),
    ]);
  });

  it("attach nothing when the write leaves the default plan as it was", async () => {
    const tenantId = randomUUID();
    await addTenants(tenantId);

    const result = await withDefaultPlanChange(async () => "written");

    expect(result).toBe("written");
    expect(await subscriptionsOf(tenantId)).toEqual([]);
  });

  it("attach the plan that became the default, never the previous one", async () => {
    const tenantId = randomUUID();
    await addTenants(tenantId);
    const intro = plan({ _id: "intro", slug: "intro", order: -1 });

    await withDefaultPlanChange(async () => {
      await GetModel(PlanModel).insert(intro);
    });

    expect(await subscriptionsOf(tenantId)).toEqual([
      expect.objectContaining({ planId: "intro" }),
    ]);
  });
});
