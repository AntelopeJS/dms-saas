import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { fromPartial } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";
import { formatPlanIntervalLabel } from "../frontend-vue/app/composables/usePlanIntervalLabel";
import { type Plan, PlanModel } from "../src/db";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";
import { useMongoDatabase } from "./helpers/mongo";
import { planRow } from "./helpers/plan-row";
import { useSuiteStripe } from "./helpers/stripe";

useMongoDatabase("plan-write-validation");
const stripe = useSuiteStripe();

type AsyncOperation = () => Promise<unknown>;
type PlanWriteBody = Parameters<SaasPlansApiController["create"]>[1];

/**
 * A plan write as the editor's request carries it: parsed JSON, so it may
 * hold what the write type rules out.
 */
function requestBody(fields: object): PlanWriteBody {
  const body: PlanWriteBody = JSON.parse(JSON.stringify(fields));
  return body;
}

const OWNER = fromPartial<User>({});
const PLAN_ID = "plan-free";
const INVALID_INTERVAL_ERROR = "saas.errors.plan.invalid_interval";

/** A plans controller writing to the catalogue, holding `current` if given. */
async function controller(current?: Plan): Promise<SaasPlansApiController> {
  await GetModel(PlanModel).table.delete().run();
  if (current) await GetModel(PlanModel).insert(current);
  const instance = new SaasPlansApiController();
  instance.planModel = GetModel(PlanModel);
  return instance;
}

/** Answers the product and price writes a plan sync makes; returns the price creation. */
function stubStripeCatalogue() {
  vi.spyOn(stripe.write.products, "create").mockResolvedValue(
    fromPartial({ id: "prod_hobby" }),
  );
  vi.spyOn(stripe.write.products, "update").mockResolvedValue(
    fromPartial({ id: "prod_hobby" }),
  );
  vi.spyOn(stripe.write.prices, "update").mockResolvedValue(fromPartial({}));
  return vi
    .spyOn(stripe.write.prices, "create")
    .mockResolvedValue(fromPartial({ id: "price_hobby" }));
}

async function expectInvalidInterval(operation: AsyncOperation): Promise<void> {
  const error = await operation().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPResult);
  expect(error).toMatchObject({
    status: 400,
    body: INVALID_INTERVAL_ERROR,
  });
}

describe("plan interval writes", () => {
  it("rejects a plan created without an interval", async () => {
    await expectInvalidInterval(async () =>
      (await controller()).create(OWNER, { name: { en: "Free" } }),
    );
  });

  it("rejects an interval outside the supported values", async () => {
    await expectInvalidInterval(async () =>
      (await controller()).create(
        OWNER,
        requestBody({
          name: { en: "Weekly" },
          interval: "week",
        }),
      ),
    );
  });

  it("rejects an unsupported interval on update", async () => {
    const plan = planRow({ _id: PLAN_ID, name: "Monthly", interval: "month" });

    const plans = await controller(plan);

    await expectInvalidInterval(() =>
      plans.update(
        OWNER,
        PLAN_ID,
        requestBody({
          interval: "week",
        }),
      ),
    );
  });

  it("requires a valid interval before Stripe-backed fields change", async () => {
    const plan = planRow({ _id: PLAN_ID, name: "Custom" });

    const plans = await controller(plan);

    await expectInvalidInterval(() =>
      plans.update(OWNER, PLAN_ID, {
        price: 20,
      }),
    );
  });

  it("accepts a write that leaves the Stripe-backed fields alone", async () => {
    const plan = planRow({ _id: PLAN_ID, name: "Custom" });
    const plans = await controller(plan);

    await expect(
      plans.update(OWNER, PLAN_ID, {
        isActive: false,
      }),
    ).resolves.toEqual({ _id: PLAN_ID });
    await expect(GetModel(PlanModel).get(PLAN_ID)).resolves.toMatchObject({
      isActive: false,
    });
  });
});

describe("plan writes and Stripe", () => {
  it("syncs a created plan once it is stored", async () => {
    const createPrice = stubStripeCatalogue();

    const plans = await controller();

    const { _id: planId } = await plans.create(
      OWNER,
      requestBody({
        name: { en: "Hobby" },
        price: 5,
        currency: "eur",
        interval: "month",
      }),
    );

    expect(createPrice).toHaveBeenCalledOnce();
    expect(createPrice.mock.calls[0]?.[0]).toMatchObject({
      unit_amount: 500,
      metadata: { planId },
    });
    await expect(GetModel(PlanModel).get(planId)).resolves.toMatchObject({
      price: 5,
      paymentProviderRefs: { stripePriceId: "price_hobby" },
    });
  });

  it("syncs an updated plan as written, not as it was", async () => {
    const plan = planRow({
      _id: PLAN_ID,
      name: { en: "Hobby" },
      price: 5,
      currency: "eur",
      interval: "month",
    });
    const plans = await controller(plan);
    const createPrice = stubStripeCatalogue();

    await plans.update(OWNER, PLAN_ID, { price: 6 });

    expect(createPrice).toHaveBeenCalledOnce();
    expect(createPrice.mock.calls[0]?.[0]).toMatchObject({ unit_amount: 600 });
  });
});

describe("plan interval labels", () => {
  const translate = (key: string): string => `translated:${key}`;

  it("translates supported intervals", () => {
    expect(formatPlanIntervalLabel("month", "plan.interval", translate)).toBe(
      "translated:plan.interval.month",
    );
    expect(formatPlanIntervalLabel("year", "plan.interval", translate)).toBe(
      "translated:plan.interval.year",
    );
  });
});
