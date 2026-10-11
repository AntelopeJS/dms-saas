import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INPUT_PATH = new URL(
  "../frontend-vue/app/build/PlanFeatureValueInput.vue",
  import.meta.url,
);

describe("PlanFeatureValueInput", () => {
  // A unit is stored `singular | plural` ("project | projects"): the plan
  // editor's feature matrix printed it as stored beside the limit.
  it("writes the unit in the form the typed limit takes", () => {
    const source = readFileSync(INPUT_PATH, "utf8");

    expect(source).toMatch(/agreeUnit\(props\.unit, limit\.value/);
    expect(source).toContain("{{\n\t\t\t\t\tunitLabel\n\t\t\t\t}}");
    expect(source).not.toContain("{{ unit }}");
  });
});
