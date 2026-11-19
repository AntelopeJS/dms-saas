import { z } from "zod";
import {
  type Answer,
  expect,
  type Journey,
  type JsonObject,
  test,
} from "./journeys/journey.ts";
import {
  countsById,
  DASHBOARD,
  inDays,
  putSubscription,
} from "./journeys/back-office.ts";
import {
  allPermissionIds,
  createPlan,
  fixture,
  register,
  saas,
  errorCode,
} from "./journeys/saas.ts";

const FREE_UNTIL_TOLERANCE_MS = 1000;

const grantedUntil = z.object({ freeUntil: z.string() });
const activityEntries = z.object({
  items: z.array(z.object({ title: z.string() }).passthrough()),
});

/** How far the end of a grant an answer carries is from `expected`, in milliseconds. */
function freeUntilDrift(answer: Answer, expected: string): number {
  const shown = grantedUntil.safeParse(answer.body).data?.freeUntil ?? "";
  return Math.abs(Date.parse(shown) - Date.parse(expected));
}

/** The activity entries of an answer titled as a workspace suspension. */
function suspensions(answer: Answer) {
  return activityEntries
    .parse(answer.body)
    .items.filter(
      (entry) => entry.title === "$saas.activity.platform.workspace_suspended",
    );
}

/** The operator's grant of free access to a workspace; `tenantId` is the journey's customer by default. */
function grantFreeAccess(
  journey: Journey,
  label: string,
  tenantId: string,
  body: JsonObject,
) {
  return saas(
    journey,
    label,
    "POST",
    `/workspaces/${tenantId}/grant-free-access`,
    { body },
  );
}

/** The grants the operator makes on workspaces other than the customer: a paid Stripe one, an unknown one and the default one. */
async function expectGrantsElsewhere(
  journey: Journey,
  ownPlanId: string,
  businessPlanId: string,
) {
  const stripeBacked = await register(journey, "stripe-backed", {
    workspaceName: "Billed Co",
  });
  await putSubscription(journey, stripeBacked.tenantId, ownPlanId, "active");
  const unacknowledged = await grantFreeAccess(
    journey,
    "grant over a paid Stripe subscription",
    stripeBacked.tenantId,
    { planId: ownPlanId },
  );
  expect
    .soft(
      { status: unacknowledged.status, code: errorCode(unacknowledged) },
      "a paid Stripe subscription must be acknowledged before it is cancelled",
    )
    .toEqual({
      status: 400,
      code: "saas.errors.workspace.cancellation_not_acknowledged",
    });

  const unknownTenant = await grantFreeAccess(
    journey,
    "grant on a workspace that does not exist",
    "no-such-workspace",
    { planId: ownPlanId },
  );
  expect
    .soft([404, 400], "an unknown workspace is refused")
    .toContain(unknownTenant.status);

  const noType = await grantFreeAccess(
    journey,
    "grant a business plan to the default workspace, which has no customer type",
    "default",
    { planId: businessPlanId },
  );
  expect
    .soft(
      noType.status,
      "a workspace with no customer type is offered every plan",
    )
    .toBe(200);
}

test("grant-free-access-follows-the-plan-and-date-rules", async ({
  journey,
}) => {
  const permissions = await allPermissionIds(journey);
  const own = await createPlan(journey, "own", { order: 0, permissions });
  const other = await createPlan(journey, "other", { order: 1 });
  const retired = await createPlan(journey, "retired", {
    order: 2,
    isActive: false,
  });
  const business = await createPlan(journey, "business", {
    order: 3,
    audience: "business",
  });
  const doomed = await createPlan(journey, "doomed", { order: 4 });
  await saas(
    journey,
    "delete the unused plan",
    "DELETE",
    `/plans/${doomed.id}`,
  );
  const customer = await register(journey, "grantee", {
    workspaceName: "Grantee Co",
  });
  const grant = (label: string, body: JsonObject) =>
    grantFreeAccess(journey, label, customer.tenantId, body);

  const refusals = [
    ["an unknown plan", { planId: "no-such-plan" }, "saas.errors.plan.invalid"],
    ["a deleted plan", { planId: doomed.id }, "saas.errors.plan.invalid"],
    [
      "an unsold plan the workspace is not on",
      { planId: retired.id },
      "saas.errors.plan.invalid",
    ],
    [
      "a plan for the other customer type",
      { planId: business.id },
      "saas.errors.plan.not_available_for_customer_type",
    ],
    [
      "a date in the past",
      { planId: other.id, freeUntil: "2020-01-01T00:00:00Z" },
      "saas.errors.workspace_create.free_until_past",
    ],
  ] as const;
  for (const [label, body, error] of refusals) {
    const answer = await grant(`grant ${label}`, body);
    expect
      .soft(
        { status: answer.status, code: errorCode(answer) },
        `${label}: 400 ${error}`,
      )
      .toEqual({ status: 400, code: error });
  }

  const until = inDays(30);
  const granted = await grant("grant a plan until a date", {
    planId: other.id,
    freeUntil: until,
  });
  const plan = await saas(
    journey,
    "the workspace after the grant",
    "GET",
    `/workspaces/${customer.tenantId}/overview`,
  );
  expect
    .soft(granted, "200 with the plan and the date")
    .toMatchObject({ status: 200, body: { planId: other.id } });
  expect
    .soft(freeUntilDrift(granted, until), "the granted date")
    .toBeLessThan(FREE_UNTIL_TOLERANCE_MS);
  expect
    .soft(
      plan.body,
      "the operator view reads it back: complimentary, on that plan, with that end",
    )
    .toMatchObject({ isComplimentary: true, planName: "other" });
  expect
    .soft(freeUntilDrift(plan, until), "the end the operator view reads back")
    .toBeLessThan(FREE_UNTIL_TOLERANCE_MS);

  const open = await grant("grant a plan with no end date", {
    planId: other.id,
    freeUntil: null,
  });
  const openPlan = await saas(
    journey,
    "the workspace after an open-ended grant",
    "GET",
    `/workspaces/${customer.tenantId}/overview`,
  );
  expect.soft(open.status, "a grant without a date: 200").toBe(200);
  expect
    .soft(openPlan.body, "and no freeUntil")
    .toMatchObject({ freeUntil: null, isComplimentary: true });

  await saas(
    journey,
    "stop selling the workspace's own plan",
    "PUT",
    `/plans/${other.id}`,
    { body: { isActive: false } },
  );
  const ownPlan = await grant("grant the workspace's own plan once unsold", {
    planId: other.id,
  });
  expect
    .soft(
      ownPlan.status,
      "the plan the workspace is on is always offered, even once it is no longer sold",
    )
    .toBe(200);

  await expectGrantsElsewhere(journey, own.id, business.id);
});

test("the-workspace-plan-page-shows-the-plan-the-workspace-is-on", async ({
  journey,
}) => {
  await createPlan(journey, "starter", { order: 0 });
  const gift = await createPlan(journey, "gifted", { order: 1 });
  const customer = await register(journey, "pagegrantee", {
    workspaceName: "Page Co",
  });
  const granted = await grantFreeAccess(
    journey,
    "grant the gifted plan",
    customer.tenantId,
    { planId: gift.id },
  );
  const plan = await saas(
    journey,
    "the workspace's plan page",
    "GET",
    "/tenant/plan",
    { as: "pagegrantee" },
  );

  expect.soft(granted.status, "the grant is accepted").toBe(200);
  expect
    .soft(plan.body, "current plan: gifted, complimentary")
    .toMatchObject({ current: { slug: "gifted" }, isComplimentary: true });
});

test("operator-suspension-follows-the-workspace-status", async ({
  journey,
}) => {
  const free = await createPlan(journey, "free", { order: 0 });
  const gone = await register(journey, "gone", { workspaceName: "Gone Co" });
  const held = await register(journey, "held", { workspaceName: "Held Co" });
  const live = await register(journey, "live", { workspaceName: "Live Co" });
  await putSubscription(journey, gone.tenantId, free.id, "cancelled", {
    stripe: false,
  });
  await putSubscription(journey, held.tenantId, free.id, "suspended", {
    stripe: false,
  });
  const suspend = (
    tenantId: string,
    confirmName: string,
    operationId: string,
  ) =>
    saas(
      journey,
      `suspend ${confirmName}`,
      "POST",
      `/workspaces/${tenantId}/suspend`,
      {
        body: { confirmName, operationId },
      },
    );
  const unsuspend = (tenantId: string, operationId: string) =>
    saas(
      journey,
      `reactivate ${operationId}`,
      "POST",
      `/workspaces/${tenantId}/unsuspend`,
      {
        body: { operationId },
      },
    );

  const cancelled = await suspend(gone.tenantId, "Gone Co", "suspend-gone-1");
  const again = await suspend(held.tenantId, "Held Co", "suspend-held-1");
  const notSuspended = await unsuspend(live.tenantId, "reactivate-live-1");
  const notSuspendedGone = await unsuspend(gone.tenantId, "reactivate-gone-1");
  expect
    .soft(
      cancelled,
      "a cancelled workspace cannot be suspended: 400 saas.errors.workspace.is_cancelled",
    )
    .toMatchObject({ status: 400, body: "saas.errors.workspace.is_cancelled" });
  expect
    .soft(
      again,
      "a suspended workspace cannot be suspended again: 409 saas.errors.workspace.already_suspended",
    )
    .toMatchObject({
      status: 409,
      body: "saas.errors.workspace.already_suspended",
    });
  expect
    .soft(
      notSuspended,
      "an active workspace cannot be reactivated: 409 saas.errors.workspace.not_suspended",
    )
    .toMatchObject({
      status: 409,
      body: "saas.errors.workspace.not_suspended",
    });
  expect
    .soft(
      notSuspendedGone.status,
      "a cancelled workspace cannot be reactivated: 409 not_suspended",
    )
    .toBe(409);

  const back = await unsuspend(held.tenantId, "reactivate-held-1");
  const counts = await saas(
    journey,
    "workspaces by status",
    "GET",
    `${DASHBOARD}/workspaces-by-status`,
  );
  expect.soft(back.status, "reactivating a suspended workspace: 200").toBe(200);
  expect
    .soft(countsById(counts), "suspended 0, cancelled 1")
    .toMatchObject({ suspended: 0, cancelled: 1 });
});

test("an-operator-action-leaves-an-audit-trail-and-its-id-cannot-be-reused-elsewhere", async ({
  journey,
}) => {
  const free = await createPlan(journey, "free");
  const first = await register(journey, "audited", {
    workspaceName: "Audit Co",
  });
  const second = await register(journey, "other", {
    workspaceName: "Other Co",
  });
  await fixture(journey, "free subscription", "POST", "/subscription", {
    tenantId: first.tenantId,
    planId: free.id,
    status: "active",
  });
  const suspended = await saas(
    journey,
    "suspend",
    "POST",
    `/workspaces/${first.tenantId}/suspend`,
    { body: { confirmName: "Audit Co", operationId: "audit-trail-0001" } },
  );
  const record = await saas(
    journey,
    "the operation record",
    "GET",
    `/workspaces/${first.tenantId}/operations/audit-trail-0001`,
  );
  const elsewhere = await saas(
    journey,
    "the same id for another workspace",
    "POST",
    `/workspaces/${second.tenantId}/suspend`,
    { body: { confirmName: "Other Co", operationId: "audit-trail-0001" } },
  );
  const wrongTenant = await saas(
    journey,
    "read the operation under another workspace",
    "GET",
    `/workspaces/${second.tenantId}/operations/audit-trail-0001`,
  );
  expect.soft(suspended.status, "suspended: 200").toBe(200);
  expect
    .soft(
      record.body,
      "the record: succeeded, workspace.suspend, no reconciliation needed",
    )
    .toMatchObject({
      status: "succeeded",
      action: "workspace.suspend",
      requiresReconciliation: false,
    });
  expect
    .soft(
      { status: elsewhere.status, code: errorCode(elsewhere) },
      "the same id for another workspace: 409 saas.errors.operator.idempotency_mismatch",
    )
    .toEqual({
      status: 409,
      code: "saas.errors.operator.idempotency_mismatch",
    });
  expect
    .soft(wrongTenant.status, "another workspace cannot read it: 404")
    .toBe(404);

  const lifecycle = await saas(
    journey,
    "recent activity, lifecycle",
    "GET",
    `${DASHBOARD}/activity?kind=lifecycle`,
  );
  const billing = await saas(
    journey,
    "recent activity, billing",
    "GET",
    `${DASHBOARD}/activity?kind=billing`,
  );
  const all = await saas(
    journey,
    "recent activity, all",
    "GET",
    `${DASHBOARD}/activity`,
  );
  expect.soft(suspensions(lifecycle), "lifecycle: once").toHaveLength(1);
  expect.soft(suspensions(all), "all: once").toHaveLength(1);
  expect.soft(suspensions(billing), "billing: never").toHaveLength(0);
  expect
    .soft(suspensions(lifecycle), "the entry names the workspace")
    .toMatchObject([{ params: { workspace: "Audit Co" } }]);
});
