import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatPlanIntervalLabel } from "../frontend-vue/app/composables/usePlanIntervalLabel";
import type { Plan, PlanModel } from "../src/db";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";

const stripe = vi.hoisted(() => ({
  isConfigured: false,
  syncPlanWithStripe: vi.fn(async (plan: unknown) => plan),
}));

vi.mock("../src/stripe", () => ({
  isStripeConfigured: () => stripe.isConfigured,
  syncPlanWithStripe: stripe.syncPlanWithStripe,
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Warn: vi.fn() },
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
  stripe.isConfigured = false;
  stripe.syncPlanWithStripe.mockClear();
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
    const legacyPlan = { _id: PLAN_ID, name: "Legacy" } as Plan;

    await expectInvalidInterval(() =>
      controller({ current: legacyPlan }).update(OWNER, PLAN_ID, {
        price: 20,
      }),
    );
  });

  it("skips Stripe sync for legacy plans without an interval", async () => {
    const legacyPlan = { _id: PLAN_ID, name: "Legacy" } as Plan;
    const store = { current: legacyPlan };
    stripe.isConfigured = true;

    await expect(
      controller(store).update(OWNER, PLAN_ID, {
        isActive: false,
      }),
    ).resolves.toEqual({ _id: PLAN_ID });
    expect(store.current.isActive).toBe(false);
    expect(stripe.syncPlanWithStripe).not.toHaveBeenCalled();
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
