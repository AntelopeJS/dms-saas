import { describe, expect, it } from "vitest";
import { isPlanAccess } from "../src/plans/plan-access-type";

const ACCESS = {
  parentPlanId: null,
  extraPermissions: ["settings"],
};

describe("isPlanAccess", () => {
  it.each([
    ["a boolean", true],
    ["a number", 10],
    ["a string", "pro"],
    ["null", null],
  ])("reads an access that overrides a feature with %s", (_name, value) => {
    expect(isPlanAccess({ ...ACCESS, extraFeatures: { feature: value } })).toBe(
      true,
    );
  });

  it.each([
    ["an object", { limit: 5 }],
    ["an array", [5]],
  ])("refuses an access that overrides a feature with %s", (_name, value) => {
    expect(isPlanAccess({ ...ACCESS, extraFeatures: { feature: value } })).toBe(
      false,
    );
  });

  it("refuses an access without feature overrides", () => {
    expect(isPlanAccess(ACCESS)).toBe(false);
  });
});
