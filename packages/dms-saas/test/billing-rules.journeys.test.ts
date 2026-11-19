import { z } from "zod";
import { expect, type Json, test } from "./journeys/journey.ts";
import { createPlan, register, saas } from "./journeys/saas.ts";

const SETTINGS = "/settings/billing";

const customerTimeline = z.object({
  customerTimeline: z.record(z.string(), z.unknown()),
});
const publicRules = z.object({ rules: z.record(z.string(), z.unknown()) });

/** A rule, the values the test saves in order, and whether each is inside the documented range. */
interface Range {
  key: string;
  message: string;
  cases: readonly (readonly [Json, boolean])[];
}

const RANGES: readonly Range[] = [
  {
    key: "autoSuspendDelayDays",
    message: "$saas.errors.billing_rules.suspension_days",
    cases: [
      [0, false],
      [1, true],
      [365, true],
      [366, false],
      [1.5, false],
    ],
  },
  {
    key: "dataRetentionDaysAfterCancellation",
    message: "$saas.errors.billing_rules.retention_days",
    cases: [
      [-1, false],
      [0, true],
      [3650, true],
      [3651, false],
    ],
  },
  {
    key: "maxFreeWorkspacesPerCard",
    message: "$saas.errors.billing_rules.free_workspaces_per_card",
    cases: [
      [-1, false],
      [0, true],
      [100, true],
      [101, false],
    ],
  },
  {
    key: "moneyBackGuaranteeWindowDays",
    message: "$saas.errors.billing_rules.refund_window_days",
    cases: [
      [0, false],
      [1, true],
      [365, true],
      [366, false],
    ],
  },
  {
    key: "moneyBackGuaranteeMode",
    message: "",
    cases: [
      ["full", true],
      ["prorated", true],
      ["half", false],
    ],
  },
  {
    key: "stripeTaxCode",
    message: "$saas.errors.billing_rules.tax_code",
    cases: [
      ["txcd_12345678", true],
      ["txcd_1234567", false],
      ["txcd_123456789", false],
      ["TXCD_12345678", false],
      ["txcd_1234567a", false],
    ],
  },
];

test("every-rule-is-held-to-its-documented-range", async ({ journey }) => {
  for (const { key, message, cases } of RANGES) {
    for (const [value, accepted] of cases) {
      const label = `${key} = ${JSON.stringify(value)} is ${accepted ? "accepted" : "refused"}`;
      const answer = await saas(journey, `save ${label}`, "PUT", SETTINGS, {
        body: { [key]: value },
      });
      expect.soft(answer.status, label).toBe(accepted ? 200 : 400);
      if (!accepted) {
        expect.soft(JSON.stringify(answer.body), label).toContain(message);
      }
    }
  }

  const stored = await saas(journey, "read the rules back", "GET", SETTINGS);
  expect
    .soft(
      stored.body,
      "a refused value changed nothing: the last accepted value of each rule is stored",
    )
    .toMatchObject({
      autoSuspendDelayDays: 365,
      dataRetentionDaysAfterCancellation: 3650,
      maxFreeWorkspacesPerCard: 100,
      stripeTaxCode: "txcd_12345678",
    });
});

test("a-save-keeps-what-it-leaves-out-and-reaches-the-public", async ({
  journey,
}) => {
  const before = await saas(journey, "the defaults", "GET", SETTINGS);
  expect
    .soft(
      customerTimeline.parse(before.body).customerTimeline,
      "suspension on, 14 days, 30 days of retention",
    )
    .toEqual({
      autoSuspendEnabled: true,
      autoSuspendDelayDays: 14,
      dataRetentionDaysAfterCancellation: 30,
    });
  expect
    .soft(
      before.body,
      "no free workspaces per card, no guarantee, full refund, 14-day window",
    )
    .toMatchObject({
      maxFreeWorkspacesPerCard: 0,
      moneyBackGuaranteeEnabled: false,
      moneyBackGuaranteeMode: "full",
      moneyBackGuaranteeWindowDays: 14,
    });
  expect
    .soft(before.body, "tax category txcd_10000000")
    .toMatchObject({ stripeTaxCode: "txcd_10000000" });

  const saved = await saas(journey, "save two rules", "PUT", SETTINGS, {
    body: { autoSuspendDelayDays: 7, dataRetentionDaysAfterCancellation: 90 },
  });
  expect(saved.status, "the save answers 200").toBe(200);

  await journey.restartBackend();
  const after = await saas(
    journey,
    "the rules after a restart",
    "GET",
    SETTINGS,
  );
  expect
    .soft(
      customerTimeline.parse(after.body).customerTimeline,
      "customer timeline 7 days and 90 days, suspension still on",
    )
    .toEqual({
      autoSuspendEnabled: true,
      autoSuspendDelayDays: 7,
      dataRetentionDaysAfterCancellation: 90,
    });
  expect
    .soft(after.body, "tax category untouched")
    .toMatchObject({ stripeTaxCode: "txcd_10000000" });

  const off = await saas(journey, "turn suspension off", "PUT", SETTINGS, {
    body: {
      autoSuspendEnabled: false,
      moneyBackGuaranteeEnabled: true,
      moneyBackGuaranteeWindowDays: 30,
      moneyBackGuaranteeMode: "prorated",
      maxFreeWorkspacesPerCard: 2,
    },
  });
  await createPlan(journey, "free");
  const pricing = await saas(
    journey,
    "public pricing facts",
    "GET",
    "/pricing",
    {
      as: "anon",
    },
  );
  expect.soft(off.status, "the save answers 200").toBe(200);
  expect
    .soft(
      publicRules.parse(pricing.body).rules,
      "retention, free workspaces per card and the guarantee",
    )
    .toEqual({
      moneyBackGuarantee: { windowDays: 30, mode: "prorated" },
      dataRetentionDays: 90,
      maxFreeWorkspacesPerCard: 2,
    });
});

test("only-the-platform-owner-edits-the-rules", async ({ journey }) => {
  await createPlan(journey, "free");
  const owner = await register(journey, "tenant-owner");
  expect.soft(owner.tenantId, "the workspace owner registered").not.toBe("");
  for (const [who, label] of [
    ["tenant-owner", "a workspace owner"],
    ["anon", "an anonymous caller"],
  ] as const) {
    const read = await saas(
      journey,
      `${label} reads the rules`,
      "GET",
      SETTINGS,
      {
        as: who,
      },
    );
    const write = await saas(
      journey,
      `${label} saves a rule`,
      "PUT",
      SETTINGS,
      {
        as: who,
        body: { autoSuspendDelayDays: 3 },
      },
    );
    expect.soft([401, 403], `${label} cannot read`).toContain(read.status);
    expect.soft([401, 403], `${label} cannot save`).toContain(write.status);
  }
  const stored = await saas(
    journey,
    "the rules after the refused saves",
    "GET",
    SETTINGS,
  );
  expect
    .soft(stored.body, "the delay is still 14")
    .toMatchObject({ customerTimeline: { autoSuspendDelayDays: 14 } });
});
