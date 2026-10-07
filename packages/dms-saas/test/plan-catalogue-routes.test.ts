import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Feature,
  FeatureModel,
  Plan,
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../src/db";
import { SaasPlanDeletionController } from "../src/routes/platformOwner/plan-deletion";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";

const stripe = vi.hoisted(() => ({
  syncPlanStripeRefs: vi.fn(async (plan: unknown) => plan),
  archivePlanStripeProduct: vi.fn(async () => undefined),
  planStripeSyncState: vi.fn(async () => "synced"),
}));

const worker = vi.hoisted(() => ({
  processPlanMigrationJob: vi.fn(async () => undefined),
}));

vi.mock("../src/plans/stripe-sync", () => stripe);
vi.mock("../src/workers", () => worker);

const OWNER = { _id: "operator" } as User;
const PLAN_ID = "growth";
const FIELD_REFUSAL = 400;

const CATALOGUE = [
  { _id: "projects", valueType: "number" },
  { _id: "domains", valueType: "boolean" },
] as Feature[];

interface Store {
  plans: Map<string, Plan>;
  workspaces: number;
}

function storedPlan(overrides: Partial<Plan>): Plan {
  return {
    _id: PLAN_ID,
    name: "Growth 2024",
    slug: "growth-2024",
    price: 29,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    isActive: true,
    isDeleted: false,
    paymentProviderRefs: { stripePriceId: "price_1" },
    ...overrides,
  } as Plan;
}

function planModel(store: Store): PlanModel {
  return {
    get: vi.fn(async (id: string) => store.plans.get(id)),
    update: vi.fn(async (id: string, patch: Partial<Plan>) => {
      const current = store.plans.get(id);
      if (current) store.plans.set(id, { ...current, ...patch } as Plan);
    }),
    resolveInheritance: vi.fn(async (plan: Plan) => ({
      permissions: plan.permissions ?? [],
      features: plan.features ?? [],
    })),
  } as unknown as PlanModel;
}

function plansController(store: Store): SaasPlansApiController {
  const controller = new SaasPlansApiController();
  controller.planModel = planModel(store);
  controller.featureModel = {
    getAll: vi.fn(async () => CATALOGUE),
  } as unknown as FeatureModel;
  controller.tenantSubscriptionModel = {
    countByPlan: vi.fn(async () => store.workspaces),
  } as unknown as TenantSubscriptionModel;
  return controller;
}

async function refusal(operation: () => Promise<unknown>) {
  const error = await operation().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPResult);
  return error as HTTPResult;
}

/** The field a refusal names, which the form shows the message under. */
function refusedField(error: HTTPResult): unknown {
  return (JSON.parse(String(error.getBody())) as { field?: unknown }).field;
}

function storeWith(...plans: Plan[]): Store {
  return {
    plans: new Map(plans.map((plan) => [plan._id, plan])),
    workspaces: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("plan writes from the editor", () => {
  it("refuses a feature value outside Off, a limit or Unlimited, under the access field", async () => {
    const store = storeWith(storedPlan({}));
    const error = await refusal(() =>
      plansController(store).update(OWNER, PLAN_ID, {
        inheritance: {
          parentPlanId: null,
          extraPermissions: [],
          extraFeatures: { projects: -5 },
        },
      }),
    );
    expect(error.getStatus()).toBe(FIELD_REFUSAL);
    expect(refusedField(error)).toBe("inheritance");
    expect(store.plans.get(PLAN_ID)?.features).toBeUndefined();
  });

  it("refuses a member cap of 0 under its field", async () => {
    const error = await refusal(() =>
      plansController(storeWith(storedPlan({}))).update(OWNER, PLAN_ID, {
        maxMembers: 0,
      }),
    );
    expect(refusedField(error)).toBe("maxMembers");
  });

  it("explains a price change after saving a plan already on Stripe", async () => {
    const result = await plansController(storeWith(storedPlan({}))).update(
      OWNER,
      PLAN_ID,
      { price: 34 },
    );
    expect(result.notice).toMatchObject({
      title: "$saas.catalog.editor.notice.price_changed",
    });
  });

  it("says nothing of Stripe when the price stays", async () => {
    const result = await plansController(storeWith(storedPlan({}))).update(
      OWNER,
      PLAN_ID,
      { name: "Growth" },
    );
    expect(result.notice).toBeUndefined();
  });

  it("returns a plan's values without its identity for a duplicate", async () => {
    const draft = await plansController(
      storeWith(
        storedPlan({ features: [{ featureId: "domains", value: true }] }),
      ),
    ).duplicate(OWNER, PLAN_ID);
    expect(draft).not.toHaveProperty("_id");
    expect(draft).not.toHaveProperty("paymentProviderRefs");
    expect(draft.inheritance).toMatchObject({
      extraFeatures: { domains: true },
    });
  });
});

describe("deleting a plan", () => {
  it("refuses while a workspace uses it, touching nothing", async () => {
    const store = { ...storeWith(storedPlan({})), workspaces: 2 };
    await refusal(() => plansController(store).remove(OWNER, PLAN_ID));
    expect(stripe.archivePlanStripeProduct).not.toHaveBeenCalled();
    expect(store.plans.get(PLAN_ID)?.isDeleted).toBe(false);
  });

  it("archives the Stripe product before deleting", async () => {
    const store = storeWith(storedPlan({}));
    await plansController(store).remove(OWNER, PLAN_ID);
    expect(stripe.archivePlanStripeProduct).toHaveBeenCalledOnce();
    expect(store.plans.get(PLAN_ID)).toMatchObject({
      isDeleted: true,
      isActive: false,
    });
  });

  it("keeps the plan when Stripe refuses the archive", async () => {
    stripe.archivePlanStripeProduct.mockRejectedValueOnce(new Error("Stripe"));
    const store = storeWith(storedPlan({}));
    await expect(plansController(store).remove(OWNER, PLAN_ID)).rejects.toThrow(
      "Stripe",
    );
    expect(store.plans.get(PLAN_ID)?.isDeleted).toBe(false);
  });
});

describe("retiring a plan", () => {
  function retireController(store: Store) {
    const controller = new SaasPlanDeletionController();
    controller.planModel = planModel(store);
    controller.planMigrationModel = {
      existsPendingOrRunningForPlan: vi.fn(async () => false),
      insert: vi.fn(async () => ["migration-1"]),
    } as unknown as PlanMigrationModel;
    controller.tenantSubscriptionModel = {
      countByPlan: vi.fn(async () => 12),
    } as unknown as TenantSubscriptionModel;
    return controller;
  }

  const target = storedPlan({ _id: "pro", name: "Pro", slug: "pro" });

  it("refuses a confirmation that is not the plan's key, under its field", async () => {
    const store = storeWith(storedPlan({}), target);
    const error = await refusal(() =>
      retireController(store).migrateAndDelete(OWNER, PLAN_ID, {
        targetPlanId: "pro",
        confirmText: "growth",
      }),
    );
    expect(refusedField(error)).toBe("confirmText");
    expect(worker.processPlanMigrationJob).not.toHaveBeenCalled();
    expect(store.plans.get(PLAN_ID)?.isActive).toBe(true);
  });

  it("refuses to move a plan onto itself", async () => {
    await refusal(() =>
      retireController(storeWith(storedPlan({}))).migrateAndDelete(
        OWNER,
        PLAN_ID,
        { targetPlanId: PLAN_ID, confirmText: "growth-2024" },
      ),
    );
  });

  it("closes the plan to sign-ups and starts the snapshot migration", async () => {
    const store = storeWith(storedPlan({}), target);
    const controller = retireController(store);
    const result = await controller.migrateAndDelete(OWNER, PLAN_ID, {
      targetPlanId: "pro",
      confirmText: " growth-2024 ",
    });
    expect(result).toMatchObject({ migrationId: "migration-1" });
    expect(store.plans.get(PLAN_ID)?.isActive).toBe(false);
    expect(controller.planMigrationModel.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        fromPlanName: "Growth 2024",
        toPlanName: "Pro",
        reason: "plan_retired",
        initiatedBy: "operator",
        totalWorkspaces: 12,
      }),
    ]);
    expect(worker.processPlanMigrationJob).toHaveBeenCalledWith("migration-1");
  });
});
