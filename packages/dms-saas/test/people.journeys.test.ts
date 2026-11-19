import { ANY_STRING } from "./helpers/asymmetric-matchers.ts";
import { expect, type Json, test } from "./journeys/journey.ts";
import {
  adminId,
  contains,
  createCountedSegments,
  CSV_HEADER,
  EMAIL_ALPHA,
  exportedLines,
  nested,
  saveSegment,
  segmentId,
} from "./journeys/people.ts";
import { errorCode } from "./journeys/refusals.ts";
import { createPlan, fixture, register, saas } from "./journeys/saas.ts";

const GOOD_RULES = { logical: "and", conditions: [EMAIL_ALPHA] };
const ADMIN_ROLE_REFUSALS = [401, 403];

/** A segment save that the module must refuse: what is wrong with it, the segment, the error key. */
const MALFORMED: readonly (readonly [string, Json, string])[] = [
  ["no name", { conditions: GOOD_RULES }, "name_required"],
  ["a blank name", { name: "   ", conditions: GOOD_RULES }, "name_required"],
  [
    "a 121-character name",
    { name: "n".repeat(121), conditions: GOOD_RULES },
    "too_long",
  ],
  [
    "a 501-character description",
    { name: "ok", description: "d".repeat(501), conditions: GOOD_RULES },
    "too_long",
  ],
  [
    "an unknown field",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [{ field: "shoeSize", operator: "eq", value: 1 }],
      },
    },
    "unknown_field",
  ],
  [
    "an operator the field lacks",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [{ field: "email", operator: "gt", value: "a" }],
      },
    },
    "invalid_operator",
  ],
  [
    "a list operator without a list",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [
          {
            kind: "workspaceRef",
            quantifier: "any",
            conditions: {
              logical: "and",
              conditions: [
                { field: "status", operator: "in", value: "active" },
              ],
            },
          },
        ],
      },
    },
    "invalid_value",
  ],
  [
    "a scalar operator with a list",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [{ field: "email", operator: "eq", value: ["a"] }],
      },
    },
    "invalid_value",
  ],
  [
    "a group that is neither and nor or",
    { name: "x", conditions: { logical: "xor", conditions: [] } },
    "invalid_logical",
  ],
  [
    "a workspace rule with no quantifier",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [
          {
            kind: "workspaceRef",
            conditions: { logical: "and", conditions: [] },
          },
        ],
      },
    },
    "invalid_quantifier",
  ],
  [
    "a workspace rule with a role that is not member or owner",
    {
      name: "x",
      conditions: {
        logical: "and",
        conditions: [
          {
            kind: "workspaceRef",
            quantifier: "any",
            role: "guest",
            conditions: { logical: "and", conditions: [] },
          },
        ],
      },
    },
    "invalid_role",
  ],
  [
    "9 levels",
    { name: "too deep", conditions: nested(8) },
    "conditions_too_deep",
  ],
];

test("platform-admin-roles-follow-their-rules", async ({ journey }) => {
  await createPlan(journey, "free");
  const colleague = await register(journey, "colleague");
  const admin = await adminId(journey);
  const owners = (path: string, as: string) =>
    saas(journey, `${path} as ${as}`, "POST", `/platform-owners/${path}`, {
      as,
    });
  const sneaky = await owners(`${colleague.userId}/promote`, "colleague");
  const promoted = await owners(`${colleague.userId}/promote`, "admin");
  const twice = await owners(`${colleague.userId}/promote`, "admin");
  expect
    .soft(sneaky.status, "a workspace owner cannot promote")
    .toBeOneOf(ADMIN_ROLE_REFUSALS);
  expect
    .soft(promoted, "promoting answers 200 with the user id")
    .toMatchObject({ status: 200, body: { userId: colleague.userId } });
  expect.soft(twice.status, "promoting an admin again: 409").toBe(409);
  expect
    .soft(errorCode(twice), "promoting an admin again")
    .toBe("saas.errors.platform_owner.already_owner");

  const self = await owners(`${admin}/demote`, "admin");
  const demoted = await owners(`${colleague.userId}/demote`, "admin");
  const notAdmin = await owners(`${colleague.userId}/demote`, "admin");
  expect.soft(self.status, "nobody demotes themselves: 400").toBe(400);
  expect
    .soft(errorCode(self), "nobody demotes themselves")
    .toBe("saas.errors.platform_owner.cannot_demote_self");
  expect.soft(demoted.status, "another admin is demoted: 200").toBe(200);
  expect
    .soft(notAdmin.status, "demoting a user who is not an admin: 409")
    .toBe(409);
  expect
    .soft(errorCode(notAdmin), "demoting a user who is not an admin")
    .toBe("saas.errors.platform_owner.not_owner");

  const back = await owners(`${colleague.userId}/promote-confirm`, "admin");
  expect
    .soft(back.status, "the promote confirmation is a GET, so POST is refused")
    .toBeGreaterThanOrEqual(400);
});

test("a-segment-rejects-malformed-rules", async ({ journey }) => {
  for (const [label, body, key] of MALFORMED) {
    const answer = await saveSegment(
      journey,
      `save a segment with ${label}`,
      body,
    );
    expect.soft(answer.status, `${label}: 400`).toBe(400);
    expect.soft(errorCode(answer), label).toBe(`saas.errors.segments.${key}`);
  }
  const depth7 = await saveSegment(journey, "save a segment 7 groups deep", {
    name: "deep ok",
    conditions: nested(6),
  });
  expect
    .soft(depth7.status, "8 levels (7 groups and a condition): 200")
    .toBe(200);
});

test("a-segment-counts-the-users-its-rules-match", async ({ journey }) => {
  await createPlan(journey, "free");
  for (const name of ["alpha", "beta", "gamma"]) {
    const visitor = await register(journey, name);
    await fixture(
      journey,
      `publish the state of the workspace of ${name}`,
      "POST",
      "/recompute",
      { tenantId: visitor.tenantId },
    );
  }
  const { only, either, both, owners, everyone } =
    await createCountedSegments(journey);
  for (const answer of [only, either, both, owners, everyone]) {
    expect.soft(answer.status, "the segment is saved: 200").toBe(200);
    expect.soft(segmentId(answer), "the segment has an id").not.toBe("");
  }
  expect
    .soft(only.body, "only alpha: 1 user")
    .toMatchObject({ estimatedCount: 1 });
  expect
    .soft(either.body, "alpha or beta: 2 users")
    .toMatchObject({ estimatedCount: 2 });
  expect
    .soft(both.body, "alpha and beta: 0 users")
    .toMatchObject({ estimatedCount: 0 });
  expect
    .soft(
      owners.body,
      "owners of a free workspace: the 3 registered visitors and the platform admin",
    )
    .toMatchObject({ estimatedCount: 4 });
  expect
    .soft(
      everyone.body,
      "a verified e-mail: only the platform admin (visitors are not verified)",
    )
    .toMatchObject({ estimatedCount: 1 });

  const preview = await saas(
    journey,
    "preview the or rule before saving",
    "POST",
    "/segments/preview",
    {
      body: {
        conditions: { logical: "or", conditions: [contains("gamma")] },
      },
    },
  );
  const joined = await register(journey, "alpha2");
  await fixture(
    journey,
    "publish the state of the new workspace",
    "POST",
    "/recompute",
    { tenantId: joined.tenantId },
  );
  const refreshed = await saas(
    journey,
    "evaluate now",
    "POST",
    `/segments/${segmentId(only)}/evaluate`,
  );
  expect
    .soft(JSON.stringify(preview.body), "the preview matches gamma")
    .toContain("gamma");
  expect
    .soft(JSON.stringify(preview.body), "the preview matches gamma only")
    .not.toContain("beta");
  expect.soft(joined.answer.status, "alpha2 registered").toBe(200);
  expect
    .soft(refreshed.body, "evaluate now: 2 users contain alpha")
    .toMatchObject({ estimatedCount: 2 });

  const copy = await saas(
    journey,
    "duplicate the segment",
    "POST",
    `/segments/${segmentId(only)}/duplicate`,
  );
  expect.soft(copy.status, "a duplicate: 200").toBe(200);
  expect
    .soft(segmentId(copy), "a duplicate has an id of its own")
    .not.toBe(segmentId(only));
  expect.soft(segmentId(copy), "a duplicate has an id").not.toBe("");
  expect
    .soft(copy.body, "it counts the same users")
    .toMatchObject({ estimatedCount: 2 });

  const probe = await fixture(journey, "ping", "GET", "/ping");
  expect.soft(probe.status, "the fixture still answers").toBe(200);
});

test("the-segment-export-writes-one-row-per-matching-user-with-owned-mrr", async ({
  journey,
}) => {
  await createPlan(journey, "free", { order: 0 });
  const pro = await createPlan(journey, "pro", { price: 50, order: 1 });
  const payer = await register(journey, "csv-payer", {
    workspaceName: "Payer Co",
  });
  const freebie = await register(journey, "csv-free", {
    workspaceName: "Free Co",
  });
  await fixture(journey, "bill the payer", "POST", "/subscription", {
    tenantId: payer.tenantId,
    planId: pro.id,
    status: "active",
    stripeCustomerId: "cus_csv",
    stripeSubscriptionId: "sub_csv",
  });
  await fixture(journey, "publish the free workspace", "POST", "/recompute", {
    tenantId: freebie.tenantId,
  });
  const segment = await saveSegment(journey, "create the segment", {
    name: "CSV owners",
    conditions: {
      logical: "and",
      conditions: [{ field: "email", operator: "contains", value: "csv-" }],
    },
  });
  const [header, ...rows] = await exportedLines(journey, segmentId(segment));
  const columns = rows.map((row) => row.split(","));
  expect.soft(header, "the header").toBe(CSV_HEADER);
  expect
    .soft(
      columns.map((row) => row[1]),
      "two rows, sorted by e-mail",
    )
    .toEqual([freebie.email, payer.email]);
  expect
    .soft(
      columns[1],
      "the payer's row: names, verification flag, workspaces, owned workspaces and owned_mrr 50.00",
    )
    .toEqual([
      ANY_STRING,
      payer.email,
      "Verify csv-payer",
      ANY_STRING,
      ANY_STRING,
      "false",
      "Payer Co",
      "Payer Co",
      "50.00",
    ]);
  expect
    .soft(columns[0]?.[8], "owned_mrr of the free workspace's owner: 0.00")
    .toBe("0.00");

  const noSegment = await saas(
    journey,
    "export a segment that does not exist",
    "POST",
    "/segments/no-such-segment/owners-export/start",
  );
  expect.soft(noSegment.status, "an unknown segment is 404").toBe(404);
  expect
    .soft(segment.body, "the segment matches both owners")
    .toMatchObject({ estimatedCount: 2 });
});
