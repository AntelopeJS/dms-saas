import { describe, expect, it } from "vitest";
import type { Plan } from "../src/db";
import { featureUsage, plansUsingFeature } from "../src/plans/feature-usage";
import { diffPlanFeatures, memberCapChange } from "../src/plans/plan-diff";
import {
  expandInheritance,
  invalidFeatureValues,
  isValidMemberCap,
  slugify,
  toInheritance,
} from "../src/plans/plan-write";
import { memberCapDiff } from "../src/routes/platformOwner/plan-deletion";
import {
  deleteFeatureDialog,
  deletePlanDialog,
  stopSellingDialog,
} from "../src/routes/platformOwner/plan-dialogs";

const CATALOGUE = [
  { _id: "projects", valueType: "number" as const },
  { _id: "domains", valueType: "boolean" as const },
  { _id: "support", valueType: "string" as const },
];

const NO_USAGE = {
  workspaces: 0,
  paying: 0,
  trialing: 0,
  free: 0,
  seats: 0,
  members: 0,
  mrr: 0,
};

function plan(overrides: Partial<Plan>): Plan {
  return {
    _id: "team",
    name: "Team",
    currency: "EUR",
    paymentProviderRefs: {},
    ...overrides,
  } as Plan;
}

describe("feature values a plan stores (Q36)", () => {
  it.each([
    ["projects", 0],
    ["projects", -1],
    ["projects", 1],
    ["projects", 10_000],
    ["domains", true],
    ["domains", false],
    ["support", "Email · next business day"],
  ])("accepts %s = %o", (featureId, value) => {
    expect(invalidFeatureValues([{ featureId, value }], CATALOGUE)).toEqual([]);
  });

  it.each([
    ["projects", -2],
    ["projects", 1.5],
    ["projects", "10"],
    ["domains", 1],
    ["support", 3],
    ["unknown", true],
  ])("refuses %s = %o", (featureId, value) => {
    expect(invalidFeatureValues([{ featureId, value }], CATALOGUE)).toEqual([
      featureId,
    ]);
  });

  it.each([
    [-1, true],
    [1, true],
    [25, true],
    [0, false],
    [-2, false],
    [2.5, false],
  ])("reads a member cap of %d as valid: %s", (value, expected) => {
    expect(isValidMemberCap(value)).toBe(expected);
  });
});

describe("plan inheritance as the editor writes it", () => {
  it("stores only the overridden features and the plan's own permissions", () => {
    expect(
      expandInheritance({
        inheritance: {
          parentPlanId: "starter",
          extraPermissions: ["projects.edit"],
          extraFeatures: { projects: 10 },
        },
      }),
    ).toEqual({
      inheritsFromPlanId: "starter",
      permissions: ["projects.edit"],
      features: [{ featureId: "projects", value: 10 }],
    });
  });

  it("reads the stored plan back the same way", () => {
    expect(
      toInheritance(
        plan({
          inheritsFromPlanId: "starter",
          permissions: ["projects.edit"],
          features: [{ featureId: "domains", value: true }],
        }),
      ),
    ).toEqual({
      parentPlanId: "starter",
      extraPermissions: ["projects.edit"],
      extraFeatures: { domains: true },
    });
  });

  it("drops an inheritance it cannot read", () => {
    expect(expandInheritance({ name: "Pro", inheritance: "{" })).toEqual({
      name: "Pro",
    });
  });

  it("slugs a plan name for the typed confirmation", () => {
    expect(slugify("Growth 2024 — Équipe")).toBe("growth-2024-equipe");
  });
});

describe("what changes moving between two plans", () => {
  it("words each feature as lost, gained, changed or the same", () => {
    expect(
      diffPlanFeatures(
        CATALOGUE,
        [
          { featureId: "projects", value: 25 },
          { featureId: "domains", value: true },
          { featureId: "support", value: "Forum" },
        ],
        [
          { featureId: "projects", value: -1 },
          { featureId: "support", value: "Forum" },
        ],
      ).map((change) => [change.featureId, change.kind]),
    ).toEqual([
      ["projects", "gained"],
      ["domains", "lost"],
      ["support", "same"],
    ]);
  });

  it("reads a lower limit as lost and off as the lowest", () => {
    expect(
      diffPlanFeatures(
        CATALOGUE.slice(0, 1),
        [{ featureId: "projects", value: 25 }],
        [{ featureId: "projects", value: 0 }],
      )[0]?.kind,
    ).toBe("lost");
  });

  it("reads an unlimited cap as the highest", () => {
    expect(memberCapChange(-1, 10)).toBe("lost");
    expect(memberCapChange(10, -1)).toBe("gained");
    expect(memberCapChange(10, 10)).toBe("same");
  });

  it("counts the workspaces left above a lower cap", () => {
    expect(
      memberCapDiff({ maxMembers: 25 }, { maxMembers: 10 }, [
        { seats: 19 },
        { seats: 11 },
        { seats: 4 },
      ]),
    ).toEqual({ from: 25, to: 10, kind: "lost", above: 2 });
    expect(
      memberCapDiff({ maxMembers: 10 }, { maxMembers: -1 }, [{ seats: 40 }])
        .above,
    ).toBe(0);
  });
});

describe("plans storing a feature", () => {
  const plans = [
    plan({ _id: "a", features: [{ featureId: "projects", value: 3 }] }),
    plan({ _id: "b", features: [{ featureId: "projects", value: 0 }] }),
    plan({
      _id: "gone",
      isDeleted: true,
      features: [{ featureId: "projects", value: 1 }],
    }),
  ];

  it("counts the plans storing a value of their own, deleted ones aside", () => {
    expect(plansUsingFeature(plans, "projects")).toEqual(["a", "b"]);
    expect(featureUsage(plans).get("domains")).toBeUndefined();
  });
});

describe("catalogue dialogs", () => {
  it("lists what stays on a plan whose sale stops", () => {
    const dialog = stopSellingDialog(
      plan({}),
      { ...NO_USAGE, workspaces: 46, trialing: 3, mrr: 6900 },
      "en",
    );
    expect(dialog).toMatchObject({
      title: "$saas.catalog.plans.dialog.stop_selling.title",
      description: "$saas.catalog.plans.dialog.stop_selling.description_in_use",
      params: { name: "Team" },
      color: "warning",
    });
    expect(dialog.impact?.map((entry) => entry.count)).toEqual([
      46,
      "€6,900",
      3,
    ]);
  });

  it("says nobody is affected when the plan is unused", () => {
    expect(stopSellingDialog(plan({}), NO_USAGE, "en")).toMatchObject({
      description: "$saas.catalog.plans.dialog.stop_selling.description_unused",
      impact: [],
    });
  });

  it("only explains why a plan in use cannot be deleted", () => {
    expect(
      deletePlanDialog(plan({}), { ...NO_USAGE, workspaces: 12 }),
    ).toMatchObject({ blocked: true, params: { count: 12 } });
  });

  it("names the Stripe product archived with an unused plan", () => {
    const dialog = deletePlanDialog(
      plan({
        paymentProviderRefs: { stripeProductId: "prod_Qx7Nf1234567890" },
      }),
      NO_USAGE,
    );
    expect(dialog.blocked).toBeUndefined();
    expect(dialog.impact?.[1]?.count).toBe("prod_Qx7Nf12…");
  });

  it("refuses to delete a feature plans store, with how far it reaches", () => {
    expect(
      deleteFeatureDialog("Storage", { plans: 7, workspaces: 248 }),
    ).toMatchObject({
      blocked: true,
      params: { name: "Storage", count: 7 },
      impact: [{ count: 7 }, { count: 248 }],
    });
    expect(
      deleteFeatureDialog("White-label emails", { plans: 0, workspaces: 0 })
        .blocked,
    ).toBeUndefined();
  });
});
