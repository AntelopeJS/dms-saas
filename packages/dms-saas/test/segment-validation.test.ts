import { appendSegmentCountPoint } from "@antelopejs/interface-dms-saas/db";
import { describe, expect, it } from "vitest";
import {
  weeklyChangeLine,
  weeklyCountChange,
} from "../src/data-api/platformOwner/segments";
import {
  parseSegmentConditions,
  parseSegmentInput,
  parseSegmentPatch,
} from "../src/utils";

function refused(run: () => unknown, key: string): void {
  expect(run).toThrow(
    expect.objectContaining({ body: `saas.errors.segments.${key}` }),
  );
}

describe("segment rules validation", () => {
  it("reads the rules from a JSON string or an object", () => {
    const rules = {
      logical: "or",
      conditions: [{ field: "email", operator: "contains", value: "@acme" }],
    };

    expect(parseSegmentConditions(JSON.stringify(rules))).toEqual(rules);
    expect(parseSegmentConditions(rules)).toEqual(rules);
    expect(parseSegmentConditions("")).toEqual({
      logical: "and",
      conditions: [],
    });
  });

  it("refuses a field the level does not read", () => {
    refused(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [{ field: "mrr", operator: "gt", value: 1 }],
        }),
      "unknown_field",
    );
  });

  it("refuses an operator the field does not offer", () => {
    refused(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [{ field: "isValidated", operator: "gt", value: 1 }],
        }),
      "invalid_operator",
    );
  });

  it("asks a list for any of / none of, and a single value otherwise", () => {
    const workspaceRule = (operator: string, value: unknown) => ({
      logical: "and",
      conditions: [
        {
          kind: "workspaceRef",
          quantifier: "any",
          role: "owner",
          conditions: {
            logical: "and",
            conditions: [{ field: "status", operator, value }],
          },
        },
      ],
    });

    refused(
      () => parseSegmentConditions(workspaceRule("in", "past_due")),
      "invalid_value",
    );
    refused(
      () => parseSegmentConditions(workspaceRule("eq", ["past_due"])),
      "invalid_value",
    );
    expect(() =>
      parseSegmentConditions(workspaceRule("in", ["past_due"])),
    ).not.toThrow();
  });

  it("refuses a workspace condition nested in another", () => {
    const ref = (conditions: unknown[]) => ({
      kind: "workspaceRef",
      quantifier: "any",
      conditions: { logical: "and", conditions },
    });

    refused(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [ref([ref([])])],
        }),
      "invalid_conditions",
    );
  });

  it("refuses rules nested deeper than the builder goes", () => {
    let group: Record<string, unknown> = { logical: "and", conditions: [] };
    for (let depth = 0; depth < 9; depth++) {
      group = { logical: "and", conditions: [group] };
    }

    refused(() => parseSegmentConditions(group), "conditions_too_deep");
  });
});

describe("segment saves", () => {
  it("requires a name on creation", () => {
    refused(() => parseSegmentInput({ name: "  " }), "name_required");
    expect(parseSegmentInput({ name: " Trials " })).toEqual({
      name: "Trials",
      description: "",
      conditions: { logical: "and", conditions: [] },
    });
  });

  it("changes only the fields an edit sends", () => {
    expect(parseSegmentPatch({ description: "For the sequence" })).toEqual({
      description: "For the sequence",
    });
    refused(() => parseSegmentPatch({ name: "" }), "name_required");
    refused(() => parseSegmentPatch({ name: "x".repeat(121) }), "too_long");
  });
});

describe("segment count history", () => {
  it("keeps one point per day, the latest evaluation of the day winning", () => {
    const morning = appendSegmentCountPoint(
      [{ day: "2026-10-06", count: 30 }],
      33,
      new Date("2026-10-07T06:00:00Z"),
    );
    const evening = appendSegmentCountPoint(
      morning,
      37,
      new Date("2026-10-07T18:00:00Z"),
    );

    expect(evening).toEqual([
      { day: "2026-10-06", count: 30 },
      { day: "2026-10-07", count: 37 },
    ]);
  });

  it("keeps the last 30 days", () => {
    let history = appendSegmentCountPoint(undefined, 0, new Date("2026-09-01"));
    for (let day = 1; day <= 40; day++) {
      history = appendSegmentCountPoint(
        history,
        day,
        new Date(Date.UTC(2026, 8, 1 + day)),
      );
    }

    expect(history).toHaveLength(30);
    expect(history.at(-1)).toEqual({ day: "2026-10-11", count: 40 });
  });

  it("reads the change over the last week", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const history = [
      { day: "2026-09-29", count: 20 },
      { day: "2026-09-30", count: 33 },
      { day: "2026-10-05", count: 35 },
    ];

    expect(weeklyCountChange(history, 37, now)).toBe(4);
    expect(weeklyCountChange(history.slice(2), 37, now)).toBe(2);
    expect(weeklyCountChange([], 37, now)).toBe(0);
  });

  it("tones the weekly change line by its direction", () => {
    expect(weeklyChangeLine(4)).toEqual({
      text: { key: "saas.segments.weekly_change.up", params: { change: 4 } },
      tone: "success",
    });
    expect(weeklyChangeLine(-2)).toEqual({
      text: { key: "saas.segments.weekly_change.down", params: { change: 2 } },
      tone: "error",
    });
    expect(weeklyChangeLine(0).tone).toBe("dimmed");
  });
});
