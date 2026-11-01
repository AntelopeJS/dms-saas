import { describe, expect, it } from "vitest";
import {
  SaasPlanEditController,
  SaasPlanNewController,
} from "../src/pages/platform/plans/edit";
import { findChild } from "./helpers/serialized";

describe("plan editor page", () => {
  it.each([
    ["new", SaasPlanNewController],
    ["edit", SaasPlanEditController],
  ])("writes the trial's unit after its field (%s)", (_name, page) => {
    const form = findChild(page.editor.serializeSync(), "form");

    expect(form?.options).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({
          id: "trialDays",
          component: expect.objectContaining({
            options: expect.objectContaining({
              suffix: "$saas.catalog.editor.field.days_unit",
            }),
          }),
        }),
      ]),
    });
  });
});
