import { z } from "zod";
import { expect, test } from "./journeys/journey.ts";
import {
  allPermissionIds,
  createPlan,
  createRole,
  fixture,
  inviteMember,
  joinMember,
  register,
  saas,
  errorCode,
} from "./journeys/saas.ts";

const workspaceListing = z.array(
  z.object({ name: z.string(), status: z.string().optional() }),
);

test("an-owner-renames-the-workspace-and-sees-it-listed", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const owner = await register(journey, "renamer", { workspaceName: "Before" });
  const renamed = await saas(
    journey,
    "rename the workspace",
    "PUT",
    "/workspaces/current",
    { as: "renamer", body: { name: "  After the rename  " } },
  );
  const current = await saas(
    journey,
    "the current workspace",
    "GET",
    "/workspaces/current",
    { as: "renamer" },
  );
  const mine = await saas(
    journey,
    "the workspaces of the account",
    "GET",
    "/workspaces/mine",
    { as: "renamer" },
  );
  const glance = await saas(
    journey,
    "the At a glance cards",
    "GET",
    "/workspaces/current/glance",
    { as: "renamer" },
  );
  expect
    .soft(renamed, "the rename answers the trimmed name")
    .toMatchObject({ status: 200, body: { name: "After the rename" } });
  expect
    .soft(current.body, "General reads it")
    .toMatchObject({ name: "After the rename", _id: owner.tenantId });
  expect
    .soft(
      mine.body,
      "the switcher lists exactly this workspace, by its new name",
    )
    .toMatchObject([{ name: "After the rename" }]);
  expect
    .soft(
      glance.body,
      "the glance cards are members, plan and owner, with 1 seat used, the plan Free and the owner's name",
    )
    .toMatchObject({
      items: [
        { id: "members", value: { params: { occupied: { value: 1 } } } },
        { id: "plan", value: "free" },
        { id: "owner", value: "Verify renamer" },
      ],
    });

  const anonymous = await saas(
    journey,
    "rename without a session",
    "PUT",
    "/workspaces/current",
    { as: "anon", body: { name: "Hijack" } },
  );
  const unchanged = await saas(
    journey,
    "the name after the refused rename",
    "GET",
    "/workspaces/current",
    { as: "renamer" },
  );
  expect
    .soft([401, 403], "an anonymous caller cannot rename")
    .toContain(anonymous.status);
  expect
    .soft(unchanged.body, "the name is unchanged")
    .toMatchObject({ name: "After the rename" });
});

test("deleting-a-workspace-needs-its-name-and-revokes-access", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  await register(journey, "leaver", { workspaceName: "Doomed" });
  const mismatch = {
    status: 400,
    code: "saas.errors.workspace.delete_confirmation_mismatch",
  };
  const wrong = await saas(
    journey,
    "delete with the wrong name",
    "POST",
    "/workspaces/current/delete",
    { as: "leaver", body: { confirmName: "doomed!" } },
  );
  const missing = await saas(
    journey,
    "delete without a name",
    "POST",
    "/workspaces/current/delete",
    { as: "leaver", body: {} },
  );
  const still = await saas(
    journey,
    "the workspace after the refusals",
    "GET",
    "/workspaces/current",
    { as: "leaver" },
  );
  expect
    .soft({ status: wrong.status, code: errorCode(wrong) }, "a wrong name")
    .toEqual(mismatch);
  expect
    .soft(
      { status: missing.status, code: errorCode(missing) },
      "a missing name",
    )
    .toEqual(mismatch);
  expect
    .soft(still, "the workspace is still readable")
    .toMatchObject({ status: 200, body: { name: "Doomed" } });

  const retention = await saas(
    journey,
    "the retention the page announces",
    "GET",
    "/settings/billing",
  );
  const deleted = await saas(
    journey,
    "delete with the exact name (padded)",
    "POST",
    "/workspaces/current/delete",
    { as: "leaver", body: { confirmName: "  Doomed " } },
  );
  const after = await saas(
    journey,
    "rename after the deletion",
    "PUT",
    "/workspaces/current",
    { as: "leaver", body: { name: "Revived" } },
  );
  const listed = await saas(
    journey,
    "the account's workspaces after the deletion",
    "GET",
    "/workspaces/mine",
    { as: "leaver" },
  );
  expect.soft(deleted.status, "the deletion is accepted").toBe(200);
  expect
    .soft(retention.body, "the default retention is 30 days")
    .toMatchObject({ dataRetentionDaysAfterCancellation: 30 });
  expect
    .soft(after.status, "the owner can no longer change the workspace")
    .toBeGreaterThanOrEqual(400);
  expect
    .soft(
      workspaceListing
        .parse(listed.body)
        .filter((entry) => entry.name === "Doomed")
        .map((entry) => entry.status),
      "the switcher shows it cancelled",
    )
    .toContain("cancelled");
});

test("an-operator-suspension-closes-the-workspace-until-reactivation", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const customer = await register(journey, "suspended", {
    workspaceName: "Quiet Co",
  });
  const base = `/workspaces/${customer.tenantId}`;
  const wrong = await saas(
    journey,
    "suspend with the wrong name",
    "POST",
    `${base}/suspend`,
    { body: { confirmName: "Loud Co", operationId: "suspend-wrong-1" } },
  );
  const shortId = await saas(
    journey,
    "suspend with a 7-character operation id",
    "POST",
    `${base}/suspend`,
    { body: { confirmName: "Quiet Co", operationId: "short-1" } },
  );
  const badChars = await saas(
    journey,
    "suspend with an operation id that has spaces",
    "POST",
    `${base}/suspend`,
    { body: { confirmName: "Quiet Co", operationId: "has spaces here" } },
  );
  expect
    .soft({ status: wrong.status, code: errorCode(wrong) }, "wrong name")
    .toEqual({
      status: 400,
      code: "saas.errors.workspace.confirmation_mismatch",
    });
  expect.soft(shortId.status, "7 characters").toBe(400);
  expect.soft(badChars.status, "spaces").toBe(400);

  const suspended = await saas(
    journey,
    "suspend the workspace",
    "POST",
    `${base}/suspend`,
    { body: { confirmName: "Quiet Co", operationId: "suspend-quiet-1" } },
  );
  const again = await saas(
    journey,
    "suspend again with the same operation",
    "POST",
    `${base}/suspend`,
    { body: { confirmName: "Quiet Co", operationId: "suspend-quiet-1" } },
  );
  const plan = await saas(
    journey,
    "the plan page stays readable",
    "GET",
    "/tenant/plan",
    { as: "suspended" },
  );
  const rename = await saas(
    journey,
    "rename while suspended",
    "PUT",
    "/workspaces/current",
    { as: "suspended", body: { name: "Changed" } },
  );
  expect.soft(suspended.status, "the suspension answers 200").toBe(200);
  expect
    .soft(
      again.status,
      "the same operation id and values repeats without error",
    )
    .toBe(200);
  expect.soft(plan.status, "the plan page is still readable").toBe(200);
  expect.soft(rename.status, "a rename is refused").toBeGreaterThanOrEqual(400);

  const reuse = await saas(
    journey,
    "reuse the operation id for another action",
    "POST",
    `${base}/unsuspend`,
    { body: { operationId: "suspend-quiet-1" } },
  );
  expect
    .soft(
      { status: reuse.status, code: errorCode(reuse) },
      "an operation id keeps its first action and values",
    )
    .toEqual({
      status: 409,
      code: "saas.errors.operator.idempotency_mismatch",
    });

  const reactivated = await saas(
    journey,
    "reactivate the workspace",
    "POST",
    `${base}/unsuspend`,
    { body: { operationId: "reactivate-quiet-1" } },
  );
  const renamed = await saas(
    journey,
    "rename after reactivation",
    "PUT",
    "/workspaces/current",
    { as: "suspended", body: { name: "Back Again" } },
  );
  expect.soft(reactivated.status, "reactivation answers 200").toBe(200);
  expect
    .soft(renamed, "a rename works again")
    .toMatchObject({ status: 200, body: { name: "Back Again" } });
});

test("a-member-cannot-rename-delete-or-export-the-workspace", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "boss", {
    workspaceName: "Team Space",
  });
  const member = await joinMember(journey, "boss", "teammate");
  expect(member.ok, "the member signed up through the invitation").toBe(true);

  const rename = await saas(
    journey,
    "the member renames",
    "PUT",
    "/workspaces/current",
    { as: "teammate", body: { name: "Hijacked" } },
  );
  const del = await saas(
    journey,
    "the member deletes",
    "POST",
    "/workspaces/current/delete",
    { as: "teammate", body: { confirmName: "Team Space" } },
  );
  const overview = await saas(
    journey,
    "the member reads the danger zone",
    "GET",
    "/workspaces/current/overview",
    { as: "teammate" },
  );
  const exported = await saas(
    journey,
    "the member starts a data export",
    "POST",
    "/data-export/start",
    { as: "teammate" },
  );
  expect
    .soft(
      {
        rename: rename.status,
        delete: del.status,
        overview: overview.status,
        dataExport: exported.status,
      },
      "every owner-only action is refused to a member",
    )
    .toEqual({ rename: 403, delete: 403, overview: 403, dataExport: 403 });

  const billingInfo = await saas(
    journey,
    "the member saves billing information",
    "PUT",
    "/tenant/billing-info",
    { as: "teammate", body: { customerType: "individual" } },
  );
  const planChange = await saas(
    journey,
    "the member changes the plan",
    "PUT",
    "/tenant/plan",
    { as: "teammate", body: { planId: "none" } },
  );
  const cancellation = await saas(
    journey,
    "the member cancels the plan",
    "POST",
    "/tenant/plan/cancellation",
    { as: "teammate", body: {} },
  );
  const portal = await saas(
    journey,
    "the member opens the billing portal",
    "POST",
    "/billing/portal-session",
    { as: "teammate", body: {} },
  );
  expect
    .soft(
      {
        billingInfo: billingInfo.status,
        planChange: planChange.status,
        cancellation: cancellation.status,
        portal: portal.status,
      },
      "only the workspace owner changes the plan, the card and the billing information",
    )
    .toEqual({
      billingInfo: 403,
      planChange: 403,
      cancellation: 403,
      portal: 403,
    });

  const glance = await saas(
    journey,
    "the member reads the At a glance cards",
    "GET",
    "/workspaces/current/glance",
    { as: "teammate" },
  );
  const current = await saas(
    journey,
    "the owner reads the workspace",
    "GET",
    "/workspaces/current",
    { as: "boss" },
  );
  expect.soft(glance.status, "the member reads the glance cards").toBe(200);
  expect
    .soft(current.body, "the workspace keeps its name and id")
    .toMatchObject({ name: "Team Space", _id: owner.tenantId });
});

test("deleting-a-workspace-cancels-its-pending-invitations", async ({
  journey,
}) => {
  await createPlan(journey, "free", {
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "leaver", {
    workspaceName: "Closing Down",
  });
  const role = await createRole(journey, "leaver");
  const pending = journey.email("pending");
  const invited = await inviteMember(journey, "leaver", pending, role);
  const before = await fixture(
    journey,
    "the invitations before the deletion",
    "GET",
    `/invites/${owner.tenantId}`,
  );
  expect(invited.answer.status, "the invitation was accepted for sending").toBe(
    200,
  );
  expect(before.body, "one invitation, to the invited address").toMatchObject([
    { email: pending },
  ]);

  const deleted = await saas(
    journey,
    "delete the workspace",
    "POST",
    "/workspaces/current/delete",
    { as: "leaver", body: { confirmName: "Closing Down" } },
  );
  const after = await fixture(
    journey,
    "the invitations after the deletion",
    "GET",
    `/invites/${owner.tenantId}`,
  );
  expect.soft(deleted.status, "deleted: 200").toBe(200);
  expect.soft(after.body, "no invitation is left").toEqual([]);
});

test("an-operation-id-is-8-to-64-letters-digits-or-hyphens", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const customer = await register(journey, "idcheck", {
    workspaceName: "Ids Ltd",
  });
  const base = `/workspaces/${customer.tenantId}`;
  const suspend = (operationId: string) =>
    saas(
      journey,
      `suspend with an id of ${operationId.length} characters`,
      "POST",
      `${base}/suspend`,
      { body: { confirmName: "Ids Ltd", operationId } },
    );
  const refusedIds = [
    ["7 characters", "a".repeat(7)],
    ["65 characters", "a".repeat(65)],
    ["an underscore", "abcd_efgh"],
    ["a dot", "abcd.efgh"],
    ["a slash", "abcd/efgh"],
  ] as const;
  for (const [label, operationId] of refusedIds) {
    const answer = await suspend(operationId);
    expect.soft(answer.status, `${label}: refused`).toBe(400);
  }

  const eight = await suspend("Ab-12-cd");
  expect
    .soft(
      eight.status,
      "8 characters, with a capital, digits and hyphens, is accepted",
    )
    .toBe(200);
  const sixtyFour = await saas(
    journey,
    "reactivate with an id of 64 characters",
    "POST",
    `${base}/unsuspend`,
    { body: { operationId: "-".repeat(32) + "z".repeat(32) } },
  );
  expect.soft(sixtyFour.status, "64 characters is accepted").toBe(200);
  const recorded = await saas(
    journey,
    "read the recorded operation",
    "GET",
    `${base}/operations/Ab-12-cd`,
  );
  expect
    .soft(recorded, "the accepted operation is recorded under its id")
    .toMatchObject({ status: 200, body: { requiresReconciliation: false } });
});
