import { z } from "zod";
import { expect, test } from "./journeys/journey.ts";
import {
  createCappedPlan,
  createPlansFromPaddedNames,
  offeredPlan,
  retirePlan,
  settledPlan,
  slugs,
} from "./journeys/plans.ts";
import { errorCode } from "./journeys/refusals.ts";
import {
  createdId,
  createPlan,
  planBody,
  register,
  saas,
} from "./journeys/saas.ts";

const migration = z.object({ migrationId: z.string() });

test("a-plan-write-is-validated-and-defaulted", async ({ journey }) => {
  const { first, one, two } = await createPlansFromPaddedNames(journey);
  expect
    .soft(
      one.body,
      "the slug comes from the trimmed name, the name is saved trimmed, and the documented defaults apply",
    )
    .toMatchObject({
      slug: "pro-plan",
      name: { en: "Pro Plan" },
      isActive: true,
      isPublic: true,
      maxMembers: -1,
      order: 0,
    });
  expect
    .soft(
      two.body,
      "the second plan takes the next order, its interval stored as written",
    )
    .toMatchObject({
      order: 1,
      interval: "year",
    });

  const interval = await saas(
    journey,
    "create a weekly plan",
    "POST",
    "/plans",
    {
      body: planBody({ slug: "weekly", interval: "week" }),
    },
  );
  expect
    .soft(interval.status, "only a documented interval is accepted: 400")
    .toBe(400);
  expect
    .soft(errorCode(interval), "only a documented interval is accepted")
    .toBe("saas.errors.plan.invalid_interval");

  for (const [value, accepted] of [
    [-1, true],
    [1, true],
    [25, true],
    [0, false],
    [-2, false],
    [1.5, false],
  ] as const) {
    const answer = await createCappedPlan(journey, value);
    expect
      .soft(
        answer.status,
        `maxMembers ${value} is ${accepted ? "accepted" : "refused"}`,
      )
      .toBe(accepted ? 200 : 400);
    if (!accepted) {
      expect
        .soft(
          JSON.stringify(answer.body),
          `maxMembers ${value} is refused with $saas.errors.plan.invalid_member_cap`,
        )
        .toContain("$saas.errors.plan.invalid_member_cap");
    }
  }

  const missing = await saas(
    journey,
    "read a plan that does not exist",
    "GET",
    "/plans/no-such-plan",
  );
  const put = await saas(
    journey,
    "save a plan that does not exist",
    "PUT",
    "/plans/no-such-plan",
    {
      body: { order: 3 },
    },
  );
  expect.soft(missing.status, "GET of an unknown plan: 404").toBe(404);
  expect
    .soft(errorCode(missing), "GET of an unknown plan")
    .toBe("saas.errors.plan.not_found");
  expect.soft(put.status, "PUT of an unknown plan: 404").toBe(404);
  expect
    .soft(errorCode(put), "PUT of an unknown plan")
    .toBe("saas.errors.plan.not_found");

  const partial = await saas(
    journey,
    "change only the order",
    "PUT",
    `/plans/${createdId(first)}`,
    {
      body: { order: 7 },
    },
  );
  const after = await saas(
    journey,
    "read the plan after a partial save",
    "GET",
    `/plans/${createdId(first)}`,
  );
  expect.soft(partial.status, "a partial save: 200").toBe(200);
  expect
    .soft(
      after.body,
      "a save keeps the fields and texts it leaves out: order 7, name and slug unchanged",
    )
    .toMatchObject({ order: 7, slug: "pro-plan", name: { en: "Pro Plan" } });
});

test("a-paid-plan-is-saved-but-not-payable-without-stripe", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const paid = await saas(journey, "create a paid plan", "POST", "/plans", {
    body: planBody({ slug: "pro", price: 29, order: 1 }),
  });
  expect.soft(paid.status, "the plan is saved: 200").toBe(200);
  expect.soft(createdId(paid), "the plan is saved with an id").not.toBe("");
  expect
    .soft(JSON.stringify(paid.body), "the notice says Stripe is not configured")
    .toContain("$saas.catalog.editor.notice.stripe_not_synced");

  const visitor = await register(journey, "shopper");
  const plan = await saas(
    journey,
    "the plans the workspace is offered",
    "GET",
    "/tenant/plan",
    {
      as: "shopper",
    },
  );
  expect.soft(visitor.answer.status, "the workspace registered").toBe(200);
  expect
    .soft(
      offeredPlan(plan, createdId(paid)),
      "the paid plan is offered, and checkoutAvailable is false",
    )
    .toEqual({ _id: createdId(paid), checkoutAvailable: false });

  const pricing = await saas(journey, "public pricing", "GET", "/pricing", {
    as: "anon",
  });
  expect
    .soft(
      pricing.body,
      "pricing still lists the free then the pro plan at 29 EUR",
    )
    .toMatchObject({
      plans: [
        { slug: "free", price: 0 },
        { slug: "pro", price: 29 },
      ],
    });
});

test("stop-selling-moves-nobody-and-delete-needs-an-empty-plan", async ({
  journey,
}) => {
  const free = await createPlan(journey, "free");
  const spare = await createPlan(journey, "spare", { order: 3 });
  const visitor = await register(journey, "resident");
  expect
    .soft(visitor.answer.status, "a workspace sits on the free plan")
    .toBe(200);

  const off = await saas(
    journey,
    "stop selling the free plan",
    "PUT",
    `/plans/${free.id}`,
    {
      body: { isActive: false },
    },
  );
  const plan = await saas(
    journey,
    "the resident's plan",
    "GET",
    "/tenant/plan",
    {
      as: "resident",
    },
  );
  const pricing = await saas(journey, "pricing", "GET", "/pricing", {
    as: "anon",
  });
  expect.soft(off.status, "stop selling: 200").toBe(200);
  expect
    .soft(plan.body, "the resident is still on the free plan")
    .toMatchObject({ current: { _id: free.id } });
  expect
    .soft(pricing.body, "pricing lists only the spare plan")
    .toMatchObject({ plans: [{ slug: "spare" }] });

  const refused = await saas(
    journey,
    "delete the plan that holds a workspace",
    "DELETE",
    `/plans/${free.id}`,
  );
  expect
    .soft(refused.status, "deleting a plan that holds a workspace: 409")
    .toBe(409);
  expect
    .soft(errorCode(refused), "deleting a plan that holds a workspace")
    .toBe("saas.errors.plan.has_workspaces");

  const removed = await saas(
    journey,
    "delete the unused plan",
    "DELETE",
    `/plans/${spare.id}`,
  );
  const listed = await saas(
    journey,
    "the catalogue after the delete",
    "GET",
    "/plans",
  );
  expect.soft(removed.status, "an empty plan is deleted: 200").toBe(200);
  expect.soft(slugs(listed), "spare is not listed").not.toContain("spare");
});

test("retiring-a-plan-needs-its-slug-and-an-active-target", async ({
  journey,
}) => {
  const source = await createPlan(journey, "source", { order: 0 });
  const target = await createPlan(journey, "target", { order: 1 });
  const dormant = await createPlan(journey, "dormant", {
    order: 2,
    isActive: false,
  });
  const visitor = await register(journey, "mover");
  expect
    .soft(visitor.answer.status, "a workspace sits on the source plan")
    .toBe(200);

  const retire = (
    label: string,
    body: { targetPlanId: string; confirmText: string },
  ) => retirePlan(journey, source.id, label, body);
  const wrongText = await retire("retire with the wrong confirmation", {
    targetPlanId: target.id,
    confirmText: "nope",
  });
  const inactive = await retire("retire towards an inactive plan", {
    targetPlanId: dormant.id,
    confirmText: "source",
  });
  const itself = await retire("retire towards itself", {
    targetPlanId: source.id,
    confirmText: "source",
  });
  expect.soft(wrongText.status, "a wrong typed key is 400").toBe(400);
  expect.soft(inactive.status, "an inactive target is 400").toBe(400);
  expect
    .soft(errorCode(inactive), "an inactive target")
    .toBe("saas.errors.plan.target_must_be_active");
  expect.soft(itself.status, "the plan itself is 400").toBe(400);
  expect
    .soft(errorCode(itself), "the plan itself")
    .toBe("saas.errors.plan.target_must_be_active");
});

test("a-retired-plans-workspaces-move-and-the-plan-can-then-go", async ({
  journey,
}) => {
  const source = await createPlan(journey, "source", { order: 0 });
  const target = await createPlan(journey, "target", { order: 1 });
  const visitor = await register(journey, "mover");
  expect
    .soft(visitor.answer.status, "a workspace sits on the source plan")
    .toBe(200);

  const retire = (
    label: string,
    body: { targetPlanId: string; confirmText: string },
  ) => retirePlan(journey, source.id, label, body);
  const impact = await saas(
    journey,
    "the impact before retiring",
    "GET",
    `/plans-deletion/${source.id}/impact`,
  );
  expect
    .soft(
      impact.body,
      "two workspaces on the source plan (the default workspace and the resident)",
    )
    .toMatchObject({ workspaces: 2 });

  const started = await retire("retire the source plan", {
    targetPlanId: target.id,
    confirmText: " source ",
  });
  expect.soft(started.status, "the migration starts: 200").toBe(200);
  const { migrationId } = migration.parse(started.body);
  expect.soft(migrationId, "the migration has an id").not.toBe("");

  const sourceAfter = await saas(
    journey,
    "the source plan after retiring",
    "GET",
    `/plans/${source.id}`,
  );
  const second = await retire("retire again while the plan is closed", {
    targetPlanId: target.id,
    confirmText: "source",
  });
  expect
    .soft(
      sourceAfter.body,
      "the plan is closed to sign-ups and kept in the catalogue",
    )
    .toMatchObject({ isActive: false });
  expect
    .soft(sourceAfter.body, "the plan is not deleted")
    .not.toMatchObject({ isDeleted: true });
  expect
    .soft(
      second.status,
      "a second retirement is refused with 409 or starts a second migration, never silent",
    )
    .toBeOneOf([409, 200]);

  expect
    .soft(
      await settledPlan(journey, "mover", target.id),
      "the resident is moved to the target plan",
    )
    .toBe(target.id);

  const totals = await saas(
    journey,
    "the migration totals",
    "GET",
    `/plan-migrations/${migrationId}/totals`,
  );
  const workspaces = await saas(
    journey,
    "the migration's workspaces",
    "GET",
    `/plan-migrations/${migrationId}/workspaces`,
  );
  expect.soft(totals.status, "totals answer 200").toBe(200);
  expect.soft(workspaces.status, "the workspace list answers 200").toBe(200);
  expect
    .soft(
      JSON.stringify(workspaces.body),
      "the workspace list names the resident's workspace",
    )
    .toContain(visitor.tenantId);

  const removed = await saas(
    journey,
    "delete the retired plan",
    "DELETE",
    `/plans/${source.id}`,
  );
  expect
    .soft(
      removed.status,
      "once nobody is left the retired plan is deletable: 200",
    )
    .toBe(200);
});

test("only-the-platform-owner-edits-the-catalogue", async ({ journey }) => {
  const free = await createPlan(journey, "free");
  await register(journey, "customer");
  for (const [who, label] of [
    ["customer", "a workspace owner"],
    ["anon", "an anonymous caller"],
  ] as const) {
    const create = await saas(
      journey,
      `${label} creates a plan`,
      "POST",
      "/plans",
      {
        as: who,
        body: planBody({ slug: "sneaky" }),
      },
    );
    const update = await saas(
      journey,
      `${label} edits a plan`,
      "PUT",
      `/plans/${free.id}`,
      {
        as: who,
        body: { price: 99 },
      },
    );
    const remove = await saas(
      journey,
      `${label} deletes a plan`,
      "DELETE",
      `/plans/${free.id}`,
      {
        as: who,
      },
    );
    expect.soft(create.status, `${label} cannot create`).toBeOneOf([401, 403]);
    expect.soft(update.status, `${label} cannot edit`).toBeOneOf([401, 403]);
    expect.soft(remove.status, `${label} cannot delete`).toBeOneOf([401, 403]);
  }
  const stored = await saas(
    journey,
    "the plan after the refused writes",
    "GET",
    `/plans/${free.id}`,
  );
  expect
    .soft(stored.body, "the plan is unchanged: price 0")
    .toMatchObject({ price: 0 });
});

test("every-text-field-of-a-plan-is-saved-trimmed", async ({ journey }) => {
  const created = await saas(
    journey,
    "create a plan with padded texts",
    "POST",
    "/plans",
    {
      body: planBody({
        slug: "  padded  ",
        name: { en: "  Padded Name  " },
        description: { en: "  A padded description.  " },
        borderLabel: { en: "  Popular  " },
      }),
    },
  );
  const id = createdId(created);
  const read = await saas(journey, "read the plan", "GET", `/plans/${id}`);
  expect.soft(created.status, "created: 200").toBe(200);
  expect.soft(id, "created with an id").not.toBe("");
  expect
    .soft(read.body, "create stores each text and the slug trimmed")
    .toMatchObject({
      name: { en: "Padded Name" },
      description: { en: "A padded description." },
      borderLabel: { en: "Popular" },
      slug: "padded",
    });

  const saved = await saas(
    journey,
    "save padded texts",
    "PUT",
    `/plans/${id}`,
    {
      body: {
        description: { en: "\t Edited description \n" },
        borderLabel: { en: " Best value " },
      },
    },
  );
  const after = await saas(
    journey,
    "read the plan after the save",
    "GET",
    `/plans/${id}`,
  );
  expect.soft(saved.status, "saved: 200").toBe(200);
  expect
    .soft(after.body, "a save trims too and keeps the texts it leaves out")
    .toMatchObject({
      description: { en: "Edited description" },
      borderLabel: { en: "Best value" },
      name: { en: "Padded Name" },
    });

  const other = await createPlan(journey, "second", {
    name: { en: " Second " },
  });
  const second = await saas(
    journey,
    "read the second plan",
    "GET",
    `/plans/${other.id}`,
  );
  expect
    .soft(second.body, "a plan created through the helper is trimmed as well")
    .toMatchObject({ name: { en: "Second" } });
});
