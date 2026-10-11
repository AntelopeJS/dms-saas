import { describe, expect, it } from "vitest";
import { attentionState } from "../src/plans/migration-blocks";
import { missingKeys, writeText } from "./helpers/composed-text";

const TOTALS = {
  captured: 5,
  moved: 3,
  notMoved: 2,
  uncertain: 1,
  failed: 1,
  notified: 3,
};

describe("migration attention card", () => {
  it("says what its count is a count of", () => {
    expect(writeText(attentionState(TOTALS))).toBe("2 of 5 not moved");
    expect(writeText(attentionState(TOTALS), "fr-FR")).toBe(
      "2 sur 5 non déplacés",
    );
  });

  it.each(["en-GB", "fr-FR"])("%s has its key", (code) => {
    expect(missingKeys(attentionState(TOTALS), code)).toEqual([]);
  });
});
