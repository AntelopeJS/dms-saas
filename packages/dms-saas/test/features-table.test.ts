import { GetMetadata } from "@antelopejs/interface-core";
import { TableViewMeta } from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { fromPartial } from "@total-typescript/shoehorn";
import { assert, describe, expect, it } from "vitest";
import { featuresDataAPI } from "../src/data-api/platformOwner/features";

function iconOf(valueType: "number" | "string"): string | null {
  const row = new featuresDataAPI();
  row.table = fromPartial({ valueType });
  return row.valueTypeIcon;
}

describe("features table", () => {
  const columns = GetMetadata(featuresDataAPI, TableViewMeta).columns;

  it("draws each value type as a pill of its own tone and icon", () => {
    expect(columns.valueType?.display).toMatchObject({
      options: {
        tones: { boolean: "success", number: "primary", string: "warning" },
      },
    });
    const type = columns.valueType?.type;
    assert(type instanceof DefaultDataTypes.SelectType);
    expect(type.options.items.every((item) => item.icon)).toBe(true);
  });

  it("draws each feature's tile with the icon of its value type", () => {
    expect(columns.displayName?.display).toMatchObject({
      options: { iconField: "valueTypeIcon" },
    });
    expect(iconOf("number")).toBe("i-ph-hash");
    expect(iconOf("string")).toBe("i-ph-text-t");
  });
});
