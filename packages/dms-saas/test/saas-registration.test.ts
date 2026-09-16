import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  firstMissingRegistrationRequirement,
  formatRegistrationPlanPrice,
  type RegistrationPlan,
  type RegistrationRequirements,
  type RegistrationTranslator,
  resolveOfferedPlans,
  resolveSelectedPlanId,
  snapshotRegistrationExtras,
} from "../frontend-vue/app/composables/useSaasRegistration";

type LocaleTree = Record<string, unknown>;

const MET_REQUIREMENTS: RegistrationRequirements = {
  selectedPlanId: "plan_pro",
  isPaymentReady: true,
  hasAcceptedLegal: true,
  country: "BE",
};

const BASE_PLAN: RegistrationPlan = {
  _id: "plan_pro",
  name: "Pro",
  description: "",
  price: 20,
  currency: "eur",
  interval: "month",
  trialDays: 0,
  audience: "any",
  borderColor: null,
  borderLabel: null,
  order: 0,
};

function readLocale(file: string): LocaleTree {
  const url = new URL(`../frontend-vue/i18n/locales/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")) as LocaleTree;
}

/** Translates against the shipped locale files, as the running app does. */
function localeTranslator(file: string): RegistrationTranslator {
  const tree = readLocale(file);
  return (key, params) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, segment) => (node as LocaleTree | undefined)?.[segment],
        tree,
      );
    if (typeof value !== "string") throw new Error(`missing key: ${key}`);
    return Object.entries(params ?? {}).reduce(
      (text, [name, replacement]) => text.replace(`{${name}}`, replacement),
      value,
    );
  };
}

/** Intl separates amount and currency with narrow no-break spaces. */
function normaliseSpaces(value: string): string {
  return value.replace(/[  ]/g, " ");
}

describe("firstMissingRegistrationRequirement", () => {
  it("clears a form that meets every requirement", () => {
    expect(firstMissingRegistrationRequirement(MET_REQUIREMENTS)).toBeNull();
  });

  it("asks for a plan before anything else", () => {
    const requirements: RegistrationRequirements = {
      selectedPlanId: null,
      isPaymentReady: false,
      hasAcceptedLegal: false,
      country: "",
    };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.no_plan",
    );
  });

  it("reports the card only once a plan is picked", () => {
    const requirements = { ...MET_REQUIREMENTS, isPaymentReady: false };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.no_payment",
    );
  });

  it("reports the legal acceptance before the billing country", () => {
    const requirements = {
      ...MET_REQUIREMENTS,
      hasAcceptedLegal: false,
      country: "",
    };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.legal_required",
    );
  });

  it("reports the billing country last", () => {
    const requirements = { ...MET_REQUIREMENTS, country: "" };

    expect(firstMissingRegistrationRequirement(requirements)).toBe(
      "saas.register.error.no_country",
    );
  });
});

describe("resolveOfferedPlans", () => {
  const catalogue: RegistrationPlan[] = [
    { ...BASE_PLAN, _id: "plan_team", audience: "business", order: 2 },
    { ...BASE_PLAN, _id: "plan_solo", audience: "individual", order: 1 },
    { ...BASE_PLAN, _id: "plan_any", audience: "any", order: 0 },
  ];

  it("offers a customer type its own plans and the open ones", () => {
    expect(
      resolveOfferedPlans(catalogue, "business").map((p) => p._id),
    ).toEqual(["plan_any", "plan_team"]);
  });

  it("hides plans reserved for the other customer type", () => {
    expect(
      resolveOfferedPlans(catalogue, "individual").map((p) => p._id),
    ).toEqual(["plan_any", "plan_solo"]);
  });

  it("reads in the operator's order, not the order the API sent", () => {
    const shuffled = [
      { ...BASE_PLAN, _id: "third", order: 30 },
      { ...BASE_PLAN, _id: "first", order: 10 },
      { ...BASE_PLAN, _id: "second", order: 20 },
    ];

    expect(
      resolveOfferedPlans(shuffled, "individual").map((p) => p._id),
    ).toEqual(["first", "second", "third"]);
  });

  it("leaves the source catalogue untouched", () => {
    const source = [...catalogue];

    resolveOfferedPlans(source, "business");

    expect(source.map((plan) => plan._id)).toEqual(
      catalogue.map((plan) => plan._id),
    );
  });
});

describe("resolveSelectedPlanId", () => {
  const individualPlan = {
    ...BASE_PLAN,
    _id: "plan_solo",
    audience: "individual",
  };
  const businessPlans = [
    { ...BASE_PLAN, _id: "plan_team", audience: "business" },
    { ...BASE_PLAN, _id: "plan_scale", audience: "business" },
  ];

  it("selects the first plan on offer when nothing is selected yet", () => {
    expect(resolveSelectedPlanId(businessPlans, null)).toBe("plan_team");
  });

  it("keeps a selection the visitor may still subscribe to", () => {
    expect(resolveSelectedPlanId(businessPlans, "plan_scale")).toBe(
      "plan_scale",
    );
  });

  it("drops a selection the new customer type is not offered", () => {
    expect(resolveSelectedPlanId(businessPlans, individualPlan._id)).toBe(
      "plan_team",
    );
  });

  it("selects nothing when the customer type has no plan at all", () => {
    expect(resolveSelectedPlanId([], individualPlan._id)).toBeNull();
  });
});

describe("snapshotRegistrationExtras", () => {
  it("sends nothing when the consumer captured nothing", () => {
    expect(snapshotRegistrationExtras(undefined)).toBeUndefined();
    expect(snapshotRegistrationExtras({})).toBeUndefined();
  });

  it("detaches the capture from the object the consumer keeps editing", () => {
    const live = { referral: "podcast", profile: { size: "5" } };

    const captured = snapshotRegistrationExtras(live);
    live.referral = "changed after submit";
    live.profile.size = "500";

    expect(captured).toEqual({ referral: "podcast", profile: { size: "5" } });
  });
});

describe("formatRegistrationPlanPrice", () => {
  const translateEn = localeTranslator("saas-en-GB.json");
  const translateFr = localeTranslator("saas-fr-FR.json");

  it("drops the decimals of a whole amount", () => {
    expect(
      normaliseSpaces(
        formatRegistrationPlanPrice(BASE_PLAN, "en-GB", translateEn),
      ),
    ).toBe("€20/month");
  });

  it("keeps the decimals when the amount has cents", () => {
    const plan = { ...BASE_PLAN, price: 19.99 };

    expect(
      normaliseSpaces(formatRegistrationPlanPrice(plan, "en-GB", translateEn)),
    ).toBe("€19.99/month");
  });

  it("follows the locale for the amount and the cadence alike", () => {
    const plan = { ...BASE_PLAN, interval: "year", price: 200 };

    expect(
      normaliseSpaces(formatRegistrationPlanPrice(plan, "fr-FR", translateFr)),
    ).toBe("200 €/an");
  });

  it("honours the plan currency", () => {
    const plan = { ...BASE_PLAN, currency: "usd" };

    expect(
      normaliseSpaces(formatRegistrationPlanPrice(plan, "en-GB", translateEn)),
    ).toBe("US$20/month");
  });
});
