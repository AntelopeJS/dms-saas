import { describe, expect, it } from "vitest";
import { planMigrationsDataAPI } from "../src/data-api/platformOwner/plan-migrations";
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

function readGetter(name: string, table: Record<string, unknown>): unknown {
  const getter = Object.getOwnPropertyDescriptor(
    planMigrationsDataAPI.prototype,
    name,
  )?.get;
  return getter?.call({ table });
}

describe("migration list dates", () => {
  it("dates a migration to the minute, with its year when not this year's", () => {
    const thisYear = new Date().getUTCFullYear();
    const started = readGetter("startedOn", {
      createdAt: new Date(`${thisYear}-03-04T14:30:00Z`),
    });
    const finished = readGetter("finishedOn", {
      completedAt: new Date("2020-03-04T14:41:00Z"),
    });

    expect(started).toMatchObject({
      params: { value: { type: "datetime", format: "day" } },
    });
    expect(finished).toMatchObject({
      params: { value: { type: "datetime", format: "medium" } },
    });
    expect(readGetter("finishedOn", { completedAt: null })).toBeNull();
  });
});
