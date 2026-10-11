import { describe, expect, it } from "vitest";
import { FEATURES } from "../playground/src/seed/data/catalogue";
import { toFeatureRow } from "../playground/src/seed/writers/catalogue";

describe("playground catalogue seed", () => {
  it("writes a text per language in every localized feature field", () => {
    for (const row of FEATURES.map(toFeatureRow)) {
      for (const field of ["displayName", "description", "tooltip", "unit"]) {
        expect(row[field], `${String(row._id)}.${field}`).toMatchObject({
          en: expect.any(String),
          fr: expect.any(String),
        });
      }
    }
  });
});
