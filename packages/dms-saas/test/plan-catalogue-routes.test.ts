import { HTTPResult } from "@antelopejs/interface-api";
import { CROSS_INSTANCE } from "@antelopejs/interface-database";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import * as permissions from "@antelopejs/interface-dms/permissions";
import { fromPartial } from "@total-typescript/shoehorn";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STRIPE_TAX_CODE,
  FeatureModel,
  type Plan,
  PLAN_LOCALIZED_FIELDS,
  PlanMigrationModel,
  PlanModel,
  TenantSubscriptionModel,
} from "../src/db";
import type { PlanInheritanceInput } from "../src/plans/plan-write";
import { SaasPlanDeletionController } from "../src/routes/platformOwner/plan-deletion";
import {
  SaasPlansApiController,
  stripeSyncNotice,
} from "../src/routes/platformOwner/plans";
import { toMinorUnits } from "../src/utils/money";
import { implementWithDms } from "./helpers/dms";
import { useMongoDatabase } from "./helpers/mongo";
import { useSuiteStripe } from "./helpers/stripe";
import { withUnconfiguredStripe } from "./helpers/unconfigured-stripe";

useMongoDatabase("plan-catalogue-routes");
const stripe = useSuiteStripe();

const OWNER = fromPartial<User>({ _id: "operator" });
const PLAN_ID = "growth";
const FIELD_REFUSAL = 400;

const CATALOGUE = [
  { _id: "projects", valueType: "number" },
  { _id: "domains", valueType: "boolean" },
];

/** Texts of a stored plan, one value per locale. */
type PlanTexts = Partial<
  Record<"name" | "description", Record<string, string>>
>;

/**
 * Stores a plan in line with its Stripe price: the refs record the terms the
 * price was created for, so a write that leaves them alone asks Stripe
 * nothing. Its name is stored in English unless `texts` gives others.
 */
async function storePlan(
  overrides: Partial<Plan> = {},
  texts: PlanTexts = {},
): Promise<void> {
  const plan = {
    _id: PLAN_ID,
    name: "Growth 2024",
    slug: "growth-2024",
    price: 29,
    currency: "EUR",
    interval: "month",
    billingMode: "flat",
    isActive: true,
    isDeleted: false,
    ...overrides,
  } satisfies Partial<Plan>;
  const names = texts.name ?? { en: plan.name };
  await GetModel(PlanModel).insert(
    PlanModel.fromPlainData({
      ...plan,
      name: names,
      description: texts.description ?? {},
      paymentProviderRefs: {
        stripeProductId: `prod_${plan._id}`,
        stripePriceId: `price_${plan._id}`,
        stripeSyncedTerms: {
          product: {
            name: names.en ?? plan.name,
            description: texts.description?.en ?? "",
            taxCode: DEFAULT_STRIPE_TAX_CODE,
          },
          price: {
            unitAmount: toMinorUnits(plan.price, plan.currency),
            currency: plan.currency.toLowerCase(),
            interval: plan.interval,
            billingMode: plan.billingMode,
          },
        },
      },
    }).localize("*", PLAN_LOCALIZED_FIELDS),
  );
}

async function storedPlan(id = PLAN_ID): Promise<Plan | undefined> {
  return GetModel(PlanModel).get(id);
}

function plansController(): SaasPlansApiController {
  const controller = new SaasPlansApiController();
  controller.planModel = GetModel(PlanModel);
  controller.featureModel = GetModel(FeatureModel);
  controller.tenantSubscriptionModel = GetModel(
    TenantSubscriptionModel,
    CROSS_INSTANCE,
  );
  return controller;
}

/** Answers the Stripe writes a re-priced plan makes: a new price, the old archived. */
function stubRepricing() {
  vi.spyOn(stripe.write.prices, "update").mockResolvedValue(fromPartial({}));
  return vi
    .spyOn(stripe.write.prices, "create")
    .mockResolvedValue(fromPartial({ id: "price_repriced" }));
}

/** The Stripe product writes: renames, and the archive of a deleted plan. */
function stubProductWrites() {
  return vi
    .spyOn(stripe.write.products, "update")
    .mockResolvedValue(fromPartial({}));
}

/** A workspace of the catalogue: on `planId`, maybe switching to another. */
async function subscribe(
  tenantId: string,
  planId: string,
  pendingPlanId: string | null = null,
): Promise<void> {
  await GetModel(TenantSubscriptionModel, tenantId).insert({
    _id: tenantId,
    planId,
    pendingPlanId,
    status: "active",
  });
}

/** Runs `write` with Stripe unconfigured, and returns what it answered. */
async function withUnconfiguredStripeResult<T>(
  write: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  await withUnconfiguredStripe(stripe, async () => {
    result = await write();
  });
  if (result === undefined) throw new Error("The write answered nothing");
  return result;
}

/** The HTTP refusal `operation` answers with; throws when it is not refused. */
async function refusal(operation: () => Promise<object>): Promise<HTTPResult> {
  const [outcome] = await Promise.allSettled([operation()]);
  if (outcome?.status !== "rejected" || !(outcome.reason instanceof HTTPResult))
    throw new Error("The operation was not refused with an HTTP answer");
  return outcome.reason;
}

beforeAll(async () => {
  implementWithDms(permissions, "implementations/dms/permissions.js");
  for (const id of ["settings", "settings.billing"])
    permissions.RegisterPermission(id, { id, title: id });
  await GetModel(FeatureModel).insert(CATALOGUE);
});

beforeEach(async () => {
  await GetModel(PlanModel).table.delete().run();
  await GetModel(PlanMigrationModel).table.delete().run();
  for (const tenantId of ["tenant-a", "tenant-b", "tenant-pro"])
    await GetModel(TenantSubscriptionModel, tenantId).delete(tenantId);
});

describe("plan writes from the editor", () => {
  it("refuses a feature value outside Off, a limit or Unlimited, under the access field", async () => {
    await storePlan();
    const before = await storedPlan();
    const error = await refusal(() =>
      plansController().update(OWNER, PLAN_ID, {
        inheritance: {
          parentPlanId: null,
          extraPermissions: [],
          extraFeatures: { projects: -5 },
        },
      }),
    );
    expect(error.getStatus()).toBe(FIELD_REFUSAL);
    expect(JSON.parse(String(error.getBody()))).toMatchObject({
      field: "inheritance",
    });
    expect((await storedPlan())?.features).toEqual(before?.features);
  });

  it("refuses a member cap of 0 under its field", async () => {
    await storePlan();
    const error = await refusal(() =>
      plansController().update(OWNER, PLAN_ID, {
        maxMembers: 0,
      }),
    );
    expect(JSON.parse(String(error.getBody()))).toMatchObject({
      field: "maxMembers",
    });
  });

  it("explains a price change after saving a plan already on Stripe", async () => {
    await storePlan();
    const createPrice = stubRepricing();
    const result = await plansController().update(OWNER, PLAN_ID, {
      price: 34,
    });
    expect(createPrice).toHaveBeenCalledOnce();
    expect(result.notice).toMatchObject({
      title: "$saas.catalog.editor.notice.price_changed",
    });
  });

  it("says nothing of Stripe when the price stays", async () => {
    await storePlan();
    const renameProduct = stubProductWrites();
    const result = await plansController().update(OWNER, PLAN_ID, {
      name: { en: "Growth" },
    });
    expect(renameProduct).toHaveBeenCalledWith(
      "prod_growth",
      expect.objectContaining({ name: "Growth" }),
    );
    expect(result.notice).toBeUndefined();
  });

  it("warns that a paid plan was saved without Stripe when Stripe is not configured", async () => {
    await storePlan();
    const result = await withUnconfiguredStripeResult(() =>
      plansController().update(OWNER, PLAN_ID, { price: 34 }),
    );
    expect(result.notice).toEqual({
      title: "$saas.catalog.editor.notice.stripe_not_synced",
      description:
        "$saas.catalog.editor.notice.stripe_not_synced_not_configured",
      color: "warning",
    });
  });

  it("keeps the plan saved and warns when Stripe refuses the sync", async () => {
    await storePlan();
    stubRepricing().mockRejectedValueOnce(new Error("Invalid key"));

    const result = await plansController().update(OWNER, PLAN_ID, {
      price: 34,
    });

    expect((await storedPlan())?.price).toBe(34);
    expect(result.notice).toMatchObject({
      description: "$saas.catalog.editor.notice.stripe_not_synced_out_of_sync",
      color: "warning",
    });
  });

  it("stores the text fields trimmed, in every locale", async () => {
    await storePlan();
    await withUnconfiguredStripeResult(() =>
      plansController().update(OWNER, PLAN_ID, {
        name: { en: "  Growth ", fr: " Croissance " },
        description: { en: "  For growing teams.  " },
        borderLabel: { en: " Popular ", fr: "Populaire  " },
      }),
    );
    expect(await plansController().getOne(OWNER, PLAN_ID)).toMatchObject({
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
    await storePlan({ features: [{ featureId: "domains", value: true }] });
    const draft = await plansController().duplicate(OWNER, PLAN_ID);
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
    const { _id } = await plansController().create(OWNER, {
      ...NEW_PLAN,
      inheritance: {
        parentPlanId: null,
        extraPermissions: ["settings"],
        extraFeatures: {},
      },
    });
    expect((await storedPlan(_id))?.permissions).toEqual(["settings"]);
  });

  it("warns when the new paid plan could not be put on Stripe", async () => {
    const result = await withUnconfiguredStripeResult(() =>
      plansController().create(OWNER, {
        ...NEW_PLAN,
        price: 9,
        currency: "eur",
      }),
    );
    expect(result).toMatchObject({
      _id: expect.any(String),
      notice: { color: "warning" },
    });
    expect(await storedPlan(result._id)).toBeDefined();
  });

  it("refuses an access it cannot read, under its field", async () => {
    const error = await refusal(() =>
      plansController().create(OWNER, {
        ...NEW_PLAN,
        inheritance: fromPartial<PlanInheritanceInput>({ parentPlanId: null }),
      }),
    );
    expect(JSON.parse(String(error.getBody()))).toMatchObject({
      field: "inheritance",
    });
    await expect(GetModel(PlanModel).getAll()).resolves.toEqual([]);
  });

  it("keeps a plan the operator left without any permission empty", async () => {
    const { _id } = await plansController().create(OWNER, {
      ...NEW_PLAN,
      inheritance: {
        parentPlanId: null,
        extraPermissions: [],
        extraFeatures: {},
      },
    });
    expect((await storedPlan(_id))?.permissions).toEqual([]);
  });

  it("names the plans in the reader's locale, the fallback one where it has none", async () => {
    await storePlan({ order: 1 }, { name: { en: "Growth", fr: "Croissance" } });
    await storePlan({ _id: "solo", order: 2 }, { name: { en: "Solo" } });
    const catalog = await plansController().editCatalog(OWNER, "fr");
    expect(catalog.plans.map((plan) => plan.name)).toEqual([
      "Croissance",
      "Solo",
    ]);
  });

  it("keeps the texts of the other locales when one is rewritten", async () => {
    await storePlan({}, { name: { en: "Growth", fr: "Croissance" } });
    await plansController().update(OWNER, PLAN_ID, { price: 29 });
    const texts = (await plansController().getOne(OWNER, PLAN_ID)).name;
    expect(texts).toEqual({ en: "Growth", fr: "Croissance" });
  });

  it("offers the editor every registered permission for a new plan", async () => {
    const catalog = await plansController().editCatalog(OWNER, undefined);
    expect(catalog.newPlanPermissions).toEqual([
      "pages",
      "settings",
      "settings.workspace",
      "settings.billing",
    ]);
  });
});

describe("deleting a plan", () => {
  it("refuses while a workspace uses it, touching nothing", async () => {
    await storePlan();
    await subscribe("tenant-a", PLAN_ID);
    await subscribe("tenant-b", PLAN_ID);
    const archive = stubProductWrites();
    await refusal(() => plansController().remove(OWNER, PLAN_ID));
    expect(archive).not.toHaveBeenCalled();
    expect((await storedPlan())?.isDeleted).toBe(false);
  });

  it("refuses while a workspace is scheduled to switch to it", async () => {
    await storePlan();
    await subscribe("tenant-pro", "pro", PLAN_ID);
    const archive = stubProductWrites();
    const error = await refusal(() => plansController().remove(OWNER, PLAN_ID));
    expect(error.getStatus()).toBe(409);
    expect(archive).not.toHaveBeenCalled();
    expect((await storedPlan())?.isDeleted).toBe(false);
  });

  it("archives the Stripe product before deleting", async () => {
    await storePlan();
    const archive = stubProductWrites();
    await plansController().remove(OWNER, PLAN_ID);
    expect(archive).toHaveBeenCalledOnce();
    expect(archive).toHaveBeenCalledWith("prod_growth", { active: false });
    expect(await storedPlan()).toMatchObject({
      isDeleted: true,
      isActive: false,
    });
  });

  it("keeps the plan when Stripe refuses the archive", async () => {
    await storePlan();
    stubProductWrites().mockRejectedValueOnce(new Error("Stripe"));
    await expect(plansController().remove(OWNER, PLAN_ID)).rejects.toThrow(
      "Stripe",
    );
    expect((await storedPlan())?.isDeleted).toBe(false);
  });
});

describe("retiring a plan", () => {
  function retireController() {
    const controller = new SaasPlanDeletionController();
    controller.planModel = GetModel(PlanModel);
    controller.planMigrationModel = GetModel(PlanMigrationModel);
    controller.featureModel = GetModel(FeatureModel);
    return controller;
  }

  async function storeCatalogue(): Promise<void> {
    await storePlan();
    await storePlan({ _id: "pro", name: "Pro", slug: "pro" });
  }

  it("refuses a confirmation that is not the plan's key, under its field", async () => {
    await storeCatalogue();
    const error = await refusal(() =>
      retireController().migrateAndDelete(OWNER, PLAN_ID, {
        targetPlanId: "pro",
        confirmText: "growth",
      }),
    );
    expect(JSON.parse(String(error.getBody()))).toMatchObject({
      field: "confirmText",
    });
    await expect(GetModel(PlanMigrationModel).getAll()).resolves.toEqual([]);
    expect((await storedPlan())?.isActive).toBe(true);
  });

  it("refuses to move a plan onto itself", async () => {
    await storePlan();
    await expect(
      retireController().migrateAndDelete(OWNER, PLAN_ID, {
        targetPlanId: PLAN_ID,
        confirmText: "growth-2024",
      }),
    ).rejects.toBeInstanceOf(HTTPResult);
    await expect(GetModel(PlanMigrationModel).getAll()).resolves.toEqual([]);
  });

  it("closes the plan to sign-ups and starts the snapshot migration", async () => {
    await storeCatalogue();
    stubProductWrites();
    const result = await retireController().migrateAndDelete(OWNER, PLAN_ID, {
      targetPlanId: "pro",
      confirmText: " growth-2024 ",
    });
    expect((await storedPlan())?.isActive).toBe(false);
    const migrations = GetModel(PlanMigrationModel);
    expect(await migrations.get(result.migrationId)).toMatchObject({
      fromPlanName: "Growth 2024",
      toPlanName: "Pro",
      reason: "plan_retired",
      initiatedBy: "operator",
    });
    await vi.waitFor(async () =>
      expect(await migrations.get(result.migrationId)).toMatchObject({
        status: "completed",
      }),
    );
  });
});
