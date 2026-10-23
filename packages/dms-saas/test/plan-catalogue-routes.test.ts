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
import type { PlanInheritanceInput } from "../src/plans/plan-write";
import {
  SaasPlansApiController,
  stripeSyncNotice,
} from "../src/routes/platformOwner/plans";
import { toPlainData } from "@antelopejs/interface-database-decorators";
import { planRow } from "./helpers/plan-row";

const stripe = vi.hoisted(() => ({
  syncPlanStripeRefs: vi.fn(async (plan: unknown) => plan),
  archivePlanStripeProduct: vi.fn(async () => undefined),
  planStripeSyncState: vi.fn(async () => "synced"),
}));

const worker = vi.hoisted(() => ({
  processPlanMigrationJob: vi.fn(async () => undefined),
}));

const permissions = vi.hoisted(() => ({
  GetPermissions: vi.fn(async () => ({
    settings: {
      data: { id: "settings", title: "settings" },
      children: {
        billing: {
          data: { id: "settings.billing", title: "billing" },
          children: {},
        },
      },
    },
  })),
}));

vi.mock("@antelopejs/interface-dms/permissions", () => permissions);
// The default plan follows catalogue writes; its own test covers that.
vi.mock("../src/workspaces/default-plan", () => ({
  withDefaultPlanChange: (write: () => Promise<unknown>) => write(),
}));
vi.mock("../src/plans/stripe-sync", () => stripe);
vi.mock("../src/workers", () => worker);

const OWNER = { _id: "operator" } as User;
const PLAN_ID = "growth";
const NEW_PLAN_ID = "starter";
const FIELD_REFUSAL = 400;

const CATALOGUE = [
  { _id: "projects", valueType: "number" },
  { _id: "domains", valueType: "boolean" },
] as Feature[];

interface Store {
  plans: Map<string, Plan>;
  workspaces: number;
  /** Plans of the workspaces scheduled to switch to the plan. */
  scheduledFrom: string[];
}

function storedPlan(overrides: Partial<Plan>): Plan {
  return planRow({
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
  });
}

function planModel(store: Store): PlanModel {
  return {
    get: vi.fn(async (id: string) => store.plans.get(id)),
    update: vi.fn(async (id: string, patch: Partial<Plan>) => {
      const current = store.plans.get(id);
      if (current)
        store.plans.set(
          id,
          planRow({ ...toPlainData(current), ...toPlainData(patch as Plan) }),
        );
    }),
    findNotDeleted: vi.fn(async () => [...store.plans.values()]),
    insert: vi.fn(async (rows: Plan[]) => {
      const created = planRow({ ...toPlainData(rows[0]), _id: NEW_PLAN_ID });
      store.plans.set(NEW_PLAN_ID, created);
      return [NEW_PLAN_ID];
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
    findByPendingPlan: vi.fn(async (planId: string) =>
      store.scheduledFrom.map((fromPlanId) => ({
        planId: fromPlanId,
        pendingPlanId: planId,
      })),
    ),
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
    scheduledFrom: [],
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
      { name: { en: "Growth" } },
    );
    expect(result.notice).toBeUndefined();
  });

  it("warns that a paid plan was saved without Stripe when Stripe is not configured", async () => {
    stripe.planStripeSyncState.mockResolvedValueOnce("not_configured");
    const result = await plansController(storeWith(storedPlan({}))).update(
      OWNER,
      PLAN_ID,
      { price: 34 },
    );
    expect(result.notice).toEqual({
      title: "$saas.catalog.editor.notice.stripe_not_synced",
      description:
        "$saas.catalog.editor.notice.stripe_not_synced_not_configured",
      color: "warning",
    });
  });

  it("keeps the plan saved and warns when Stripe refuses the sync", async () => {
    const store = storeWith(storedPlan({}));
    stripe.syncPlanStripeRefs.mockRejectedValueOnce(new Error("Invalid key"));
    stripe.planStripeSyncState.mockResolvedValueOnce("out_of_sync");

    const result = await plansController(store).update(OWNER, PLAN_ID, {
      price: 34,
    });

    expect(store.plans.get(PLAN_ID)?.price).toBe(34);
    expect(result.notice).toMatchObject({
      description: "$saas.catalog.editor.notice.stripe_not_synced_out_of_sync",
      color: "warning",
    });
  });

  it("stores the text fields trimmed, in every locale", async () => {
    const store = storeWith(storedPlan({}));
    await plansController(store).update(OWNER, PLAN_ID, {
      name: { en: "  Growth ", fr: " Croissance " },
      description: { en: "  For growing teams.  " },
      borderLabel: { en: " Popular ", fr: "Populaire  " },
    });
    expect(await plansController(store).getOne(OWNER, PLAN_ID)).toMatchObject({
      name: { en: "Growth", fr: "Croissance" },
      description: { en: "For growing teams." },
      borderLabel: { en: "Popular", fr: "Populaire" },
    });
  });

  it.each(["synced", "off_stripe"] as const)(
    "says nothing of the sync of a plan %s",
    (state) => {
      expect(stripeSyncNotice(state)).toBeUndefined();
    },
  );

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

describe("creating a plan", () => {
  const NEW_PLAN = { name: { en: "Starter" }, interval: "month" } as const;

  it("keeps the permissions the editor sent", async () => {
    const store = storeWith();
    await plansController(store).create(OWNER, {
      ...NEW_PLAN,
      inheritance: {
        parentPlanId: null,
        extraPermissions: ["settings"],
        extraFeatures: {},
      },
    });
    expect(store.plans.get(NEW_PLAN_ID)?.permissions).toEqual(["settings"]);
  });

  it("warns when the new paid plan could not be put on Stripe", async () => {
    stripe.planStripeSyncState.mockResolvedValueOnce("not_configured");
    const result = await plansController(storeWith()).create(OWNER, NEW_PLAN);
    expect(result).toMatchObject({
      _id: NEW_PLAN_ID,
      notice: { color: "warning" },
    });
  });

  it("refuses an access it cannot read, under its field", async () => {
    const store = storeWith();
    const error = await refusal(() =>
      plansController(store).create(OWNER, {
        ...NEW_PLAN,
        inheritance: { parentPlanId: null } as unknown as PlanInheritanceInput,
      }),
    );
    expect(refusedField(error)).toBe("inheritance");
    expect(store.plans.get(NEW_PLAN_ID)).toBeUndefined();
  });

  it("keeps a plan the operator left without any permission empty", async () => {
    const store = storeWith();
    await plansController(store).create(OWNER, {
      ...NEW_PLAN,
      inheritance: {
        parentPlanId: null,
        extraPermissions: [],
        extraFeatures: {},
      },
    });
    expect(store.plans.get(NEW_PLAN_ID)?.permissions).toEqual([]);
  });

  it("names the plans in the reader's locale, the fallback one where it has none", async () => {
    const store = storeWith(
      storedPlan({ name: { en: "Growth", fr: "Croissance" } as never }),
      storedPlan({ _id: "solo", name: { en: "Solo" } as never }),
    );
    const controller = plansController(store);
    controller.featureModel = {
      getAll: vi.fn(async () => []),
    } as unknown as FeatureModel;
    const catalog = await controller.editCatalog(OWNER, "fr");
    expect(catalog.plans.map((plan) => plan.name)).toEqual([
      "Croissance",
      "Solo",
    ]);
  });

  it("keeps the texts of the other locales when one is rewritten", async () => {
    const store = storeWith(
      storedPlan({ name: { en: "Growth", fr: "Croissance" } as never }),
    );
    await plansController(store).update(OWNER, PLAN_ID, { price: 29 });
    const texts = (await plansController(store).getOne(OWNER, PLAN_ID)).name;
    expect(texts).toEqual({ en: "Growth", fr: "Croissance" });
  });

  it("offers the editor every registered permission for a new plan", async () => {
    const controller = plansController(storeWith());
    controller.featureModel = {
      getAll: vi.fn(async () => []),
    } as unknown as FeatureModel;
    const catalog = await controller.editCatalog(OWNER, undefined);
    expect(catalog.newPlanPermissions).toEqual([
      "settings",
      "settings.billing",
    ]);
  });
});

describe("deleting a plan", () => {
  it("refuses while a workspace uses it, touching nothing", async () => {
    const store = { ...storeWith(storedPlan({})), workspaces: 2 };
    await refusal(() => plansController(store).remove(OWNER, PLAN_ID));
    expect(stripe.archivePlanStripeProduct).not.toHaveBeenCalled();
    expect(store.plans.get(PLAN_ID)?.isDeleted).toBe(false);
  });

  it("refuses while a workspace is scheduled to switch to it", async () => {
    const store = { ...storeWith(storedPlan({})), scheduledFrom: ["pro"] };
    const error = await refusal(() =>
      plansController(store).remove(OWNER, PLAN_ID),
    );
    expect(error.getStatus()).toBe(409);
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
      existsUnsettledForPlan: vi.fn(async () => false),
      insert: vi.fn(async () => ["migration-1"]),
    } as unknown as PlanMigrationModel;
    controller.featureModel = {
      getAll: vi.fn(async () => []),
    } as unknown as FeatureModel;
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
    expect(controller.planMigrationModel.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPlanName: "Growth 2024",
        toPlanName: "Pro",
        reason: "plan_retired",
        initiatedBy: "operator",
      }),
    );
    expect(worker.processPlanMigrationJob).toHaveBeenCalledWith("migration-1");
  });
});
