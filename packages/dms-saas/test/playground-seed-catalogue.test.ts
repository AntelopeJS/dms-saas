import { assert, describe, expect, it } from "vitest";
import { FEATURES } from "../playground/src/seed/data/catalogue";
import { toFeatureRow } from "../playground/src/seed/writers/catalogue";
import { isRecord } from "./helpers/records";

const LOCALIZED_FIELDS = [
  "displayName",
  "description",
  "tooltip",
  "unit",
] as const;

const LANGUAGES = ["en", "fr"] as const;

describe("playground catalogue seed", () => {
  it("writes a text per language in every localized feature field", () => {
    for (const row of FEATURES.map(toFeatureRow)) {
      for (const field of LOCALIZED_FIELDS) {
        const text = row[field];
        const label = `${String(row._id)}.${field}`;
        assert(isRecord(text), `${label} holds no text per language`);
        for (const language of LANGUAGES) {
          expect(text[language], `${label}.${language}`).toEqual(
            expect.any(String),
          );
        }
      }
    }
  });
});
