import { describe, expect, it } from "vitest";
import { PlanModel } from "../src/db";
import { perLocaleTexts, planTexts } from "../src/plans/plan-write";
import { planRow } from "./helpers/plan-row";

describe("plan texts of a row written before the fields were localized", () => {
  const legacy = PlanModel.fromPlainData({
    _id: "plan_free",
    name: "Free",
    description: "$saas.plan_descriptions.free",
  });

  it("reads a plain stored text as it is stored", () => {
    expect(planTexts(legacy)).toEqual({
      name: "Free",
      description: "$saas.plan_descriptions.free",
    });
  });

  it("writes a plain stored text as the fallback locale's", () => {
    expect(perLocaleTexts(planTexts(legacy))).toEqual({
      name: { en: "Free" },
      description: { en: "$saas.plan_descriptions.free" },
    });
  });

  it("keeps the per-locale texts of a localized row", () => {
    const row = planRow({ name: "Free", description: "Starter" });

    expect(perLocaleTexts(planTexts(row))).toEqual({
      name: { en: "Free" },
      description: { en: "Starter" },
    });
  });
});
