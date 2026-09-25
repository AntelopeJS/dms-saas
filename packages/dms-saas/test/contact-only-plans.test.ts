import { HTTPResult } from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlanComparisonNote } from "../frontend-vue/app/composables/usePlanFeatureLabel";
import { getPlanContactUrl, setRuntimeConfig } from "../src/config/runtime";
import type { FeatureModel, Plan, PlanModel } from "../src/db";
import { assertPlanIsSelfServe, buildTenantPlanCatalog } from "../src/plans";
import { SaasPlansApiController } from "../src/routes/platformOwner/plans";

vi.mock("../src/stripe", () => ({
  isStripeConfigured: () => false,
  syncPlanWithStripe: async (plan: unknown) => plan,
}));

vi.mock("@antelopejs/interface-core/logging", () => ({
  Logging: { Warn: vi.fn() },
}));

const STRIPE_CONFIG = {
  secretKey: "sk_test",
  webhookSecret: "whsec_test",
  publishableKey: "pk_test",
};
const OWNER = {} as User;
const STRIPE_PRICE_ID = "price_enterprise";
const CONSUMER_PREFIX = "cloud.plan_features";
const CONSUMER_NOTE = "The plan price is prepaid usage credit.";

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "plan",
    name: "Plan",
    slug: "plan",
    description: "",
    price: 0,
    currency: "EUR",
    interval: "month",
    order: 0,
    features: [],
    permissions: [],
    inheritsFromPlanId: null,
    paymentProviderRefs: {},
    ...overrides,
  } as Plan;
}

const PRO = plan({
  _id: "pro",
  name: "Pro",
  price: 20,
  order: 30,
  paymentProviderRefs: { stripePriceId: "price_pro" },
});
const ENTERPRISE = plan({
  _id: "enterprise",
  name: "Enterprise",
  order: 40,
  isContactOnly: true,
  paymentProviderRefs: { stripePriceId: STRIPE_PRICE_ID },
});

function planModel(plans: Plan[]): PlanModel {
  return {
    resolveInheritance: async (row: Plan) => ({
      permissions: row.permissions,
      features: row.features,
    }),
    findPubliclyVisible: async () => plans,
  } as unknown as PlanModel;
}

const featureModel = { getAll: async () => [] } as unknown as FeatureModel;

function configureContactUrl(planContactUrl: string | undefined): void {
  setRuntimeConfig({ stripe: STRIPE_CONFIG, planContactUrl });
}

afterEach(() => configureContactUrl(undefined));

describe("contact-only plans in the tenant catalogue", () => {
  it("flags the plan sold on quote and never offers its checkout", async () => {
    const catalog = await buildTenantPlanCatalog(planModel([]), featureModel, [
      ENTERPRISE,
      PRO,
    ]);

    expect(
      catalog.plans.map(({ _id, isContactOnly, checkoutAvailable }) => ({
        _id,
        isContactOnly,
        checkoutAvailable,
      })),
    ).toEqual([
      { _id: "pro", isContactOnly: false, checkoutAvailable: true },
      { _id: "enterprise", isContactOnly: true, checkoutAvailable: false },
    ]);
  });

  it("lists the flag on the public plans", async () => {
    const controller = new SaasPlansApiController();
    controller.planModel = planModel([PRO, ENTERPRISE]);

    const listed = await controller.listPublic();

    expect(listed.map((row) => [row._id, row.isContactOnly])).toEqual([
      ["pro", false],
      ["enterprise", true],
    ]);
  });
});

describe("contact-only plan selection", () => {
  it("refuses a contact-only plan on every self-serve path", () => {
    let error: unknown;
    try {
      assertPlanIsSelfServe(ENTERPRISE);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HTTPResult);
    expect(error).toMatchObject({
      status: 400,
      body: "saas.errors.plan.contact_only",
    });
  });

  it("lets a priced plan through", () => {
    expect(() => assertPlanIsSelfServe(PRO)).not.toThrow();
  });

  it("stores the flag an operator sets on the plan", async () => {
    const controller = new SaasPlansApiController();
    const insert = vi.fn(async () => ["enterprise"]);
    controller.planModel = {
      insert,
      get: async () => ENTERPRISE,
      update: async () => undefined,
    } as unknown as PlanModel;

    await controller.create(OWNER, {
      name: "Enterprise",
      interval: "month",
      isContactOnly: true,
    });

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ isContactOnly: true }),
    ]);
  });
});

describe("plan contact URL", () => {
  it.each(["https://antelopejs.com/contact", "mailto:sales@antelopejs.com"])(
    "accepts %s",
    (url) => {
      configureContactUrl(url);

      expect(getPlanContactUrl()).toBe(url);
    },
  );

  it.each(["javascript:alert(1)", "not a url", "ftp://example.com"])(
    "rejects %s at startup",
    (url) => {
      expect(() => configureContactUrl(url)).toThrow(/planContactUrl/);
    },
  );

  it("is null when the deployment configures none", () => {
    expect(getPlanContactUrl()).toBeNull();
  });
});

describe("plan comparison note", () => {
  const messages: Record<string, string> = {
    [`${CONSUMER_PREFIX}.comparison_note`]: CONSUMER_NOTE,
  };
  const lookup = (key: string): string | null => messages[key] ?? null;

  it("reads the note under the first consumer prefix that has one", () => {
    expect(
      resolvePlanComparisonNote(["other.prefix", CONSUMER_PREFIX], lookup),
    ).toBe(CONSUMER_NOTE);
  });

  it("shows no note of its own without a consumer one", () => {
    expect(resolvePlanComparisonNote([], lookup)).toBeNull();
    expect(resolvePlanComparisonNote(["other.prefix"], lookup)).toBeNull();
  });
});
