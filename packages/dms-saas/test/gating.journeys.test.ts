import { z } from "zod";
import {
  accountWithoutWorkspace,
  catalogueEntry,
  effective,
  firstThreeLeaves,
  invite,
  PAGES_API,
  seatsOf,
  storedPermissions,
} from "./journeys/gating.ts";
import { expect, test } from "./journeys/journey.ts";
import {
  allPermissionIds,
  createPlan,
  createRole,
  inviteMember,
  joinMember,
  passwordWith,
  planBody,
  register,
  saas,
  fixture,
  errorCode,
} from "./journeys/saas.ts";

const SEAT_LIMIT = "saas.errors.plan.seat_limit_reached";
const createdRole = z.object({ id: z.string() });

test("the-plan-caps-members-and-gives-the-owner-all-of-it", async ({
  journey,
}) => {
  const [a, b, c] = firstThreeLeaves(await allPermissionIds(journey));
  const parent = await createPlan(journey, "parent", {
    permissions: [a],
    order: 1,
  });
  const child = await createPlan(journey, "child", {
    permissions: [b],
    inheritsFromPlanId: parent.id,
    order: 0,
  });
  expect.soft(parent.answer.status, "the parent plan is saved").toBe(200);
  expect.soft(child.answer.status, "the child plan is saved").toBe(200);

  const planPermissions = async () =>
    [
      ...new Set([
        ...(await storedPermissions(journey, parent.id)),
        ...(await storedPermissions(journey, child.id)),
      ]),
    ].toSorted();
  const before = await planPermissions();
  const owner = await register(journey, "boss");
  const memberId = await accountWithoutWorkspace(
    journey,
    journey.email("member"),
    passwordWith(),
  );
  const ownerSet = await effective(journey, owner.tenantId, owner.userId, [
    a,
    b,
    c,
  ]);
  const memberSet = await effective(journey, owner.tenantId, memberId, [
    a,
    b,
    c,
  ]);
  const outsideSet = await effective(journey, owner.tenantId, memberId, [c]);
  const ownerWithoutRole = await effective(
    journey,
    owner.tenantId,
    owner.userId,
    [],
  );
  const memberWithOne = await effective(journey, owner.tenantId, memberId, [b]);
  expect.soft(before, "the plan holds the parent's permissions").toContain(a);
  expect.soft(before, "the plan holds the child's permissions").toContain(b);
  expect.soft(before, "the plan holds nothing of c").not.toContain(c);
  expect
    .soft(ownerSet, "owner: exactly the plan's permissions")
    .toEqual(before);
  expect
    .soft(
      ownerWithoutRole,
      "owner with a role holding nothing still gets the plan",
    )
    .toEqual(before);
  expect
    .soft(memberSet, "member with a, b and c: the ones the plan grants")
    .toEqual([a, b, c].filter((id) => before.includes(id)).toSorted());
  expect.soft(memberSet, "that member keeps something").not.toEqual([]);
  expect
    .soft(
      outsideSet,
      "member whose role grants only what the plan lacks: nothing",
    )
    .toEqual([]);
  expect
    .soft(memberWithOne, "member with a single granted permission: that one")
    .toEqual([b]);

  const edit = await saas(
    journey,
    "the child plan stops granting b and grants c",
    "PUT",
    `/plans/${child.id}`,
    { body: { permissions: [c] } },
  );
  const after = await planPermissions();
  const afterEdit = await effective(journey, owner.tenantId, owner.userId, [
    a,
    b,
    c,
  ]);
  expect.soft(edit.status, "a plan edit: 200").toBe(200);
  expect.soft(after, "the plan now holds a").toContain(a);
  expect.soft(after, "the plan now holds c").toContain(c);
  expect.soft(after, "the plan no longer holds b").not.toContain(b);
  expect
    .soft(afterEdit, "owner has exactly the new plan permissions")
    .toEqual(after);

  const star = await saas(
    journey,
    "a plan that lists *",
    "PUT",
    `/plans/${child.id}`,
    {
      body: { permissions: ["*", c] },
    },
  );
  const ownerStar = await effective(journey, owner.tenantId, owner.userId, []);
  const memberStar = await effective(
    journey,
    owner.tenantId,
    memberId,
    [],
    true,
  );
  expect.soft(star.status, "the plan write is accepted").toBe(200);
  expect.soft(ownerStar, "the owner's set has no *").not.toContain("*");
  expect
    .soft(
      memberStar,
      "an incoming * (the platform owner's wildcard) survives for another member",
    )
    .toContain("*");
});

test("the-plan-member-cap-bounds-invitations", async ({ journey }) => {
  const ids = await allPermissionIds(journey);
  await createPlan(
    journey,
    "duo",
    planBody({ maxMembers: 2, permissions: ids }),
  );
  const owner = await register(journey, "seat-owner");
  const role = await journey.api("create a role", {
    method: "POST",
    path: `${PAGES_API}/roles/create`,
    as: "seat-owner",
    body: { name: journey.unique("Reader"), description: "", permissions: [] },
  });
  const roleId = createdRole.safeParse(role.body).data?.id ?? "";
  expect.soft(role.status, "the owner can create a role: 200").toBe(200);
  expect.soft(roleId, "the role has an id").not.toBe("");

  const first = await invite(journey, "seat-owner", "first", roleId);
  const seats = await seatsOf(journey, "seat-owner");
  const second = await invite(journey, "seat-owner", "second", roleId);
  expect.soft(first.status, "the first invitation is accepted").toBe(200);
  expect
    .soft(seats, "seats: 1 member, 1 pending invitation, 2 occupied")
    .toEqual({ members: 1, pendingInvites: 1, occupied: 2 });
  expect.soft(second.status, "the second invitation is refused: 409").toBe(409);
  expect
    .soft(errorCode(second), "the second invitation is refused")
    .toBe(SEAT_LIMIT);
  expect.soft(owner.tenantId, "the workspace still has its owner").not.toBe("");
});

test("platform-support-and-expired-invitations-take-no-seat", async ({
  journey,
}) => {
  await createPlan(journey, "duo", {
    maxMembers: 2,
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "host");
  const role = await createRole(journey, "host");
  expect
    .soft(await seatsOf(journey, "host"), "the workspace holds its owner alone")
    .toEqual({ members: 1, pendingInvites: 0, occupied: 1 });

  const joined = await saas(
    journey,
    "the platform admin joins as support",
    "POST",
    `/workspaces/${owner.tenantId}/join`,
  );
  const again = await saas(
    journey,
    "the platform admin joins again",
    "POST",
    `/workspaces/${owner.tenantId}/join`,
  );
  expect
    .soft(joined, "joined: 200")
    .toMatchObject({ status: 200, body: { joined: true } });
  expect.soft(again.status, "joining twice: 409").toBe(409);
  expect
    .soft(errorCode(again), "joining twice")
    .toBe("saas.errors.workspace.already_member");
  expect
    .soft(
      await seatsOf(journey, "host"),
      "joining as support takes no seat: the seats are unchanged",
    )
    .toEqual({ members: 1, pendingInvites: 0, occupied: 1 });

  await fixture(journey, "an expired invitation", "POST", "/expired-invite", {
    tenantId: owner.tenantId,
    email: journey.email("late"),
    roleId: role,
  });
  expect
    .soft(
      await seatsOf(journey, "host"),
      "an expired invitation takes no seat: 0 pending invitations",
    )
    .toEqual({ members: 1, pendingInvites: 0, occupied: 1 });

  const last = await inviteMember(journey, "host", journey.email("last"), role);
  expect
    .soft(last.answer.status, "the second seat is still invitable")
    .toBe(200);
  expect
    .soft(await seatsOf(journey, "host"), "1 member and 1 pending invitation")
    .toEqual({ members: 1, pendingInvites: 1, occupied: 2 });
  const third = await inviteMember(
    journey,
    "host",
    journey.email("third"),
    role,
  );
  expect.soft(third.answer.status, "a third address is refused: 409").toBe(409);
  expect
    .soft(errorCode(third.answer), "a third address is refused")
    .toBe(SEAT_LIMIT);
});

test("a-cap-lowered-under-the-member-count-keeps-members-and-stops-invitations", async ({
  journey,
}) => {
  const plan = await createPlan(journey, "trio", {
    maxMembers: 3,
    permissions: await allPermissionIds(journey),
  });
  const owner = await register(journey, "chief");
  const role = await createRole(journey, "chief");
  const member = await joinMember(journey, "chief", "second", role);
  const third = await joinMember(journey, "chief", "third", role);
  expect
    .soft(member.ok, "the second member's invitation was accepted")
    .toBe(true);
  expect
    .soft(third.ok, "the third member's invitation was accepted")
    .toBe(true);
  expect
    .soft(
      await seatsOf(journey, "chief"),
      "the workspace is full with 3 members",
    )
    .toEqual({ members: 3, pendingInvites: 0, occupied: 3 });

  const lowered = await saas(
    journey,
    "lower the cap to 1",
    "PUT",
    `/plans/${plan.id}`,
    {
      body: { maxMembers: 1 },
    },
  );
  const stillIn = await saas(
    journey,
    "the third member reads the workspace",
    "GET",
    "/workspaces/current/glance",
    { as: "third" },
  );
  const refused = (
    await inviteMember(journey, "chief", journey.email("more"), role)
  ).answer;
  expect.soft(lowered.status, "the cap is lowered: 200").toBe(200);
  expect
    .soft(
      stillIn.status,
      "a member beyond the new cap still reads the workspace",
    )
    .toBe(200);
  expect
    .soft(await seatsOf(journey, "chief"), "the seats still count 3 members")
    .toEqual({ members: 3, pendingInvites: 0, occupied: 3 });
  expect.soft(refused.status, "a new invitation is refused: 409").toBe(409);
  expect
    .soft(errorCode(refused), "a new invitation is refused")
    .toBe(SEAT_LIMIT);
  expect.soft(owner.tenantId, "the owner is unchanged").not.toBe("");
  expect
    .soft(
      await catalogueEntry(journey, "trio"),
      "the catalogue stores the lowered cap",
    )
    .toMatchObject({ maxMembers: 1 });
});
