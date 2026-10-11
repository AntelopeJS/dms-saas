import { describe, expect, it } from "vitest";
import {
  SaasPlanEditController,
  SaasPlanNewController,
} from "../src/pages/platform/plans/edit";

interface SerializedField {
  id: string;
  component?: { options?: Record<string, unknown> };
}

interface SerializedBlock {
  options?: { fields?: SerializedField[] };
  children: { id: string; component: SerializedBlock }[];
}

function formFields(block: SerializedBlock): SerializedField[] {
  const form = block.children[0]?.component.children.find(
    (child) => child.id === "form",
  )?.component;
  return form?.options?.fields ?? [];
}

describe("plan editor page", () => {
  it.each([
    ["new", SaasPlanNewController],
    ["edit", SaasPlanEditController],
  ])("writes the trial's unit after its field (%s)", (_name, page) => {
    const editor = page.editor.serializeSync() as SerializedBlock;
    const trial = formFields(editor).find((field) => field.id === "trialDays");

    expect(trial?.component?.options).toMatchObject({
      suffix: "$saas.catalog.editor.field.days_unit",
    });
  });
});
