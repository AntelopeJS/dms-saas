import type { JsonValue } from "../src/utils/json-value";
import {
  SEGMENT_COUNT_HISTORY_DAYS,
  appendSegmentCountPoint,
} from "@antelopejs/interface-dms-saas/db";
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

/** Expects `parse` to throw the refusal a segment parser throws, by its error key. */
function expectRefusal(parse: () => void, key: string): void {
  expect(parse).toThrow(
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

  it("refuses a __proto__ key in the rules, as a string or an object", () => {
    const top = '{"logical":"and","conditions":[],"__proto__":{"x":1}}';
    const nested =
      '{"logical":"and","conditions":[{"field":"email","operator":"contains","value":{"__proto__":{"a":1}}}]}';
    const wire: JsonValue = {
      logical: "and",
      conditions: [],
      ["__proto__"]: { x: 1 },
    };

    expectRefusal(() => parseSegmentConditions(top), "invalid_conditions");
    expectRefusal(() => parseSegmentConditions(wire), "invalid_conditions");
    expectRefusal(() => parseSegmentConditions(nested), "invalid_conditions");
  });

  it("refuses a __proto__ key at any depth of a condition value", () => {
    const rule = (value: string) =>
      `{"logical":"and","conditions":[{"field":"email","operator":"contains","value":${value}}]}`;
    const workspaceRule = (value: string) =>
      `{"logical":"and","conditions":[{"kind":"workspaceRef","quantifier":"any","conditions":{"logical":"and","conditions":[{"field":"status","operator":"in","value":${value}}]}}]}`;

    expectRefusal(
      () => parseSegmentConditions(rule('{"a":{"b":{"__proto__":1}}}')),
      "invalid_conditions",
    );
    expectRefusal(
      () => parseSegmentConditions(workspaceRule('[{"__proto__":1}]')),
      "invalid_conditions",
    );
    expectRefusal(
      () =>
        parseSegmentConditions(workspaceRule('[["x",{"a":{"__proto__":1}}]]')),
      "invalid_conditions",
    );
  });

  const leaf = (condition: JsonValue): JsonValue => ({
    logical: "and",
    conditions: [condition],
  });
  const workspaceLeaf = (value: JsonValue): JsonValue =>
    leaf({
      kind: "workspaceRef",
      quantifier: "any",
      conditions: leaf({ field: "status", operator: "in", value }),
    });

  it.each<[string, JsonValue]>([
    ["a condition with no value", leaf({ field: "email", operator: "eq" })],
    [
      "an object value",
      leaf({ field: "email", operator: "eq", value: { a: 1 } }),
    ],
    [
      "an empty object value",
      leaf({ field: "email", operator: "contains", value: {} }),
    ],
    ["a list holding a list", workspaceLeaf([["active"]])],
    ["a list holding an object", workspaceLeaf([{}])],
  ])("keeps accepting %s, as it did before", (_name, rules) => {
    expect(parseSegmentConditions(rules)).toEqual(rules);
    expect(parseSegmentConditions(JSON.stringify(rules))).toEqual(rules);
  });

  const poisoned: JsonValue = { ["__proto__"]: { x: 1 } };
  const nodesWithAnExtraKey: [string, (extra: JsonValue) => JsonValue][] = [
    [
      "a condition",
      (extra) =>
        leaf({ field: "email", operator: "contains", value: "a", extra }),
    ],
    ["the root group", (extra) => ({ logical: "and", conditions: [], extra })],
    [
      "a nested group",
      (extra) => leaf({ logical: "or", conditions: [], extra }),
    ],
    [
      "a workspace condition",
      (extra) =>
        leaf({
          kind: "workspaceRef",
          quantifier: "any",
          conditions: leaf({ field: "status", operator: "in", value: ["a"] }),
          extra,
        }),
    ],
    [
      "the group inside a workspace condition",
      (extra) =>
        leaf({
          kind: "workspaceRef",
          quantifier: "any",
          conditions: {
            logical: "and",
            conditions: [{ field: "status", operator: "in", value: ["a"] }],
            extra,
          },
        }),
    ],
  ];

  it.each(nodesWithAnExtraKey)(
    "refuses a __proto__ key under an extra key of %s, as a string or an object",
    (_name, rulesWith) => {
      for (const extra of [poisoned, [poisoned], { deeper: [poisoned] }]) {
        const rules = rulesWith(extra);

        expectRefusal(
          () => parseSegmentConditions(rules),
          "invalid_conditions",
        );
        expectRefusal(
          () => parseSegmentConditions(JSON.stringify(rules)),
          "invalid_conditions",
        );
      }
    },
  );

  it.each(nodesWithAnExtraKey)(
    "keeps accepting an extra key of %s that holds no __proto__ key",
    (_name, rulesWith) => {
      const rules = rulesWith({ b: [1, { c: "__proto__" }] });

      expect(parseSegmentConditions(rules)).toEqual(rules);
      expect(parseSegmentConditions(JSON.stringify(rules))).toEqual(rules);
    },
  );

  it("refuses a __proto__ key under an extra key however deep, without overflowing", () => {
    let extra: JsonValue = poisoned;
    for (let depth = 0; depth < 100_000; depth++) {
      extra = { a: extra };
    }

    expectRefusal(
      () => parseSegmentConditions({ logical: "and", conditions: [], extra }),
      "invalid_conditions",
    );
  });

  it("reports a tree nested past the limit as too deep, however deep", () => {
    const deep = (levels: number) =>
      '{"logical":"and","conditions":['.repeat(levels) + "]}".repeat(levels);

    for (const levels of [9, 1100, 20000]) {
      expectRefusal(
        () => parseSegmentConditions(deep(levels)),
        "conditions_too_deep",
      );
    }
  });

  it("refuses a field the level does not read", () => {
    expectRefusal(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [{ field: "mrr", operator: "gt", value: 1 }],
        }),
      "unknown_field",
    );
  });

  it("refuses an operator the field does not offer", () => {
    expectRefusal(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [{ field: "isValidated", operator: "gt", value: 1 }],
        }),
      "invalid_operator",
    );
  });

  it("asks a list for any of / none of, and a single value otherwise", () => {
    const workspaceRule = (operator: string, value: JsonValue) => ({
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

    expectRefusal(
      () => parseSegmentConditions(workspaceRule("in", "past_due")),
      "invalid_value",
    );
    expectRefusal(
      () => parseSegmentConditions(workspaceRule("eq", ["past_due"])),
      "invalid_value",
    );
    expect(() =>
      parseSegmentConditions(workspaceRule("in", ["past_due"])),
    ).not.toThrow();
  });

  it("refuses a workspace condition nested in another", () => {
    const ref = (conditions: JsonValue[]) => ({
      kind: "workspaceRef",
      quantifier: "any",
      conditions: { logical: "and", conditions },
    });

    expectRefusal(
      () =>
        parseSegmentConditions({
          logical: "and",
          conditions: [ref([ref([])])],
        }),
      "invalid_conditions",
    );
  });

  it("refuses rules nested deeper than the builder goes", () => {
    let group: JsonValue = { logical: "and", conditions: [] };
    for (let depth = 0; depth < 9; depth++) {
      group = { logical: "and", conditions: [group] };
    }

    expectRefusal(() => parseSegmentConditions(group), "conditions_too_deep");
  });
});

describe("segment saves", () => {
  it("requires a name on creation", () => {
    expectRefusal(() => parseSegmentInput({ name: "  " }), "name_required");
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
    expectRefusal(() => parseSegmentPatch({ name: "" }), "name_required");
    expectRefusal(
      () => parseSegmentPatch({ name: "x".repeat(121) }),
      "too_long",
    );
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
    let history = appendSegmentCountPoint([], 0, new Date("2026-09-01"));
    for (let day = 1; day <= 40; day++) {
      history = appendSegmentCountPoint(
        history,
        day,
        new Date(Date.UTC(2026, 8, 1 + day)),
      );
    }

    expect(history).toHaveLength(SEGMENT_COUNT_HISTORY_DAYS);
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
