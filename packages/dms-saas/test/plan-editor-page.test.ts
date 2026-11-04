import { assert, describe, expect, it } from "vitest";
import {
  SaasPlanEditController,
  SaasPlanNewController,
} from "../src/pages/platform/plans/edit";
import { findChild, isOptionRecord } from "./helpers/serialized";

describe("plan editor page", () => {
  it.each([
    ["new", SaasPlanNewController],
    ["edit", SaasPlanEditController],
  ])("writes the trial's unit after its field (%s)", (_name, page) => {
    const form = findChild(page.editor.serializeSync(), "form");

    const options = form?.options;
    assert(isOptionRecord(options));
    assert(Array.isArray(options.fields));
    const trialDays: unknown = options.fields.find(
      (field) => isOptionRecord(field) && field.id === "trialDays",
    );
    expect(trialDays).toMatchObject({
      component: {
        options: { suffix: "$saas.catalog.editor.field.days_unit" },
      },
    });
  });
});
