import { GetMetadata } from "@antelopejs/interface-core";
import { TableViewMeta } from "@antelopejs/interface-dms/base";
import { describe, expect, it } from "vitest";
import { featuresDataAPI } from "../src/data-api/platformOwner/features";

describe("features table", () => {
  const columns = GetMetadata(featuresDataAPI, TableViewMeta).columns;

  it("draws each value type as a pill of its own tone and icon", () => {
    expect(columns.valueType?.display).toMatchObject({
      options: {
        tones: { boolean: "success", number: "primary", string: "warning" },
      },
    });
    const type = columns.valueType?.type as unknown as {
      options: { items: { value: string; icon?: string }[] };
    };
    expect(type.options.items.every((item) => item.icon)).toBe(true);
  });
});
