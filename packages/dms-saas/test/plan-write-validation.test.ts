import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatPlanIntervalLabel } from "../frontend-vue/app/composables/usePlanIntervalLabel";
import type { Plan, PlanModel } from "../src/db";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";

const stripe = vi.hoisted(() => ({
  syncPlanStripeRefs: vi.fn(async (plan: unknown) => plan),
}));

vi.mock("../src/plans/stripe-sync", () => ({
  syncPlanStripeRefs: stripe.syncPlanStripeRefs,
}));

interface PlanStore {
  current?: Plan;
}

interface PlanWrite {
  interval?: unknown;
  name?: string;
  price?: number;
  isActive?: boolean;
}

type AsyncOperation = () => Promise<unknown>;

const OWNER = {} as User;
const PLAN_ID = "plan-free";
const INVALID_INTERVAL_ERROR = "saas.errors.plan.invalid_interval";

function planModel(store: PlanStore): PlanModel {
  return {
    insert: vi.fn(async (rows: PlanWrite[]) => {
      store.current = {
        _id: PLAN_ID,
        paymentProviderRefs: {},
        ...rows[0],
      } as Plan;
      return [PLAN_ID];
    }),
    get: vi.fn(async () => store.current),
    findNotDeleted: vi.fn(async () => (store.current ? [store.current] : [])),
    update: vi.fn(async (_id: string, update: PlanWrite) => {
      store.current = { ...store.current, ...update } as Plan;
    }),
  } as unknown as PlanModel;
}

function controller(store: PlanStore): SaasPlansApiController {
  const instance = new SaasPlansApiController();
  instance.planModel = planModel(store);
  return instance;
}

async function expectInvalidInterval(operation: AsyncOperation): Promise<void> {
  const error = await operation().catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPResult);
  expect(error).toMatchObject({
    status: 400,
    body: INVALID_INTERVAL_ERROR,
  });
}

beforeEach(() => {
  stripe.syncPlanStripeRefs.mockClear();
});

describe("plan interval writes", () => {
  it("rejects a plan created without an interval", async () => {
    await expectInvalidInterval(() =>
      controller({}).create(OWNER, { name: "Free" }),
    );
  });

  it("rejects an interval outside the supported values", async () => {
    await expectInvalidInterval(() =>
      controller({}).create(OWNER, {
        name: "Weekly",
        interval: "week",
      } as never),
    );
  });

  it("rejects an unsupported interval on update", async () => {
    const plan = { _id: PLAN_ID, name: "Monthly", interval: "month" } as Plan;

    await expectInvalidInterval(() =>
      controller({ current: plan }).update(OWNER, PLAN_ID, {
        interval: "week",
      } as never),
    );
  });

  it("requires a valid interval before Stripe-backed fields change", async () => {
    const plan = { _id: PLAN_ID, name: "Custom" } as Plan;

    await expectInvalidInterval(() =>
      controller({ current: plan }).update(OWNER, PLAN_ID, {
        price: 20,
      }),
    );
  });

  it("accepts a write that leaves the Stripe-backed fields alone", async () => {
    const plan = { _id: PLAN_ID, name: "Custom" } as Plan;
    const store = { current: plan };

    await expect(
      controller(store).update(OWNER, PLAN_ID, {
        isActive: false,
      }),
    ).resolves.toEqual({ _id: PLAN_ID });
    expect(store.current.isActive).toBe(false);
  });
});

describe("plan writes and Stripe", () => {
  it("syncs a created plan once it is stored", async () => {
    const store: PlanStore = {};

    await controller(store).create(OWNER, {
      name: "Hobby",
      price: 5,
      interval: "month",
    } as never);

    expect(stripe.syncPlanStripeRefs).toHaveBeenCalledOnce();
    expect(stripe.syncPlanStripeRefs.mock.calls[0]?.[0]).toMatchObject({
      _id: PLAN_ID,
      price: 5,
    });
  });

  it("syncs an updated plan as written, not as it was", async () => {
    const plan = {
      _id: PLAN_ID,
      name: "Hobby",
      price: 5,
      interval: "month",
    } as Plan;
    const store = { current: plan };

    await controller(store).update(OWNER, PLAN_ID, { price: 6 });

    expect(stripe.syncPlanStripeRefs).toHaveBeenCalledOnce();
    expect(stripe.syncPlanStripeRefs.mock.calls[0]?.[0]).toMatchObject({
      price: 6,
    });
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
