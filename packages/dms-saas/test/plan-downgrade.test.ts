import { describe, expect, it } from "vitest";
import {
  isFreePlan,
  isPlanDowngrade,
  type PlanPricing,
} from "../frontend-vue/app/composables/usePlanDowngrade";

const FREE: PlanPricing = { price: 0, interval: "month" };
const STARTER: PlanPricing = { price: 10, interval: "month" };
const PRO: PlanPricing = { price: 30, interval: "month" };
const PRO_YEARLY: PlanPricing = { price: 300, interval: "year" };

describe("plan downgrade detection", () => {
  it("asks for confirmation when moving to the free plan", () => {
    expect(isPlanDowngrade(PRO, FREE, true)).toBe(true);
  });

  it("asks for confirmation when moving to a cheaper paid plan", () => {
    expect(isPlanDowngrade(PRO, STARTER, true)).toBe(true);
  });

  it("keeps upgrades on their direct flow", () => {
    expect(isPlanDowngrade(STARTER, PRO, true)).toBe(false);
    expect(isPlanDowngrade(FREE, STARTER, false)).toBe(false);
  });

  it("compares prices per month across billing intervals", () => {
    expect(isPlanDowngrade(PRO, PRO_YEARLY, true)).toBe(true);
    expect(isPlanDowngrade(STARTER, PRO_YEARLY, true)).toBe(false);
  });

  it("treats an equal monthly price as no downgrade", () => {
    expect(isPlanDowngrade(STARTER, { ...STARTER }, true)).toBe(false);
  });

  it("still guards a paid workspace whose plan left the catalog", () => {
    expect(isPlanDowngrade(null, FREE, true)).toBe(true);
    expect(isPlanDowngrade(null, FREE, false)).toBe(false);
    expect(isPlanDowngrade(null, STARTER, true)).toBe(false);
  });

  it("recognises a free plan", () => {
    expect(isFreePlan(FREE)).toBe(true);
    expect(isFreePlan(STARTER)).toBe(false);
  });
});
