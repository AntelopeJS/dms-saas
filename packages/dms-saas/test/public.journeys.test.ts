import { z } from "zod";
import { expect, test } from "./journeys/journey.ts";
import {
  NON_EMPTY_STRING,
  planRegistrationOpensOn,
  registrationAttempt,
  STRONG,
} from "./journeys/public.ts";
import {
  createPlan,
  passwordWith,
  register,
  saas,
  errorCode,
} from "./journeys/saas.ts";

const seatsOf = z.object({ seats: z.unknown() });

test("a-visitor-registers-onto-the-default-plan", async ({ journey }) => {
  const free = await createPlan(journey, "free", { name: { en: "Free" } });
  expect(free.answer.status, "POST /plans answers 200").toBe(200);
  expect(free.id, "the free plan is saved").not.toBe("");
  const named = await register(journey, "named", {
    workspaceName: "  Acme Lab  ",
  });
  const plain = await register(journey, "plain");
  expect(named.answer.status, "named registers").toBe(200);
  expect(named.tenantId, "named has a workspace").not.toBe("");
  expect(named.userId, "named has a user").not.toBe("");
  expect(plain.answer.status, "plain registers").toBe(200);
  expect(plain.tenantId, "plain has a workspace").not.toBe("");
  expect(plain.userId, "plain has a user").not.toBe("");
  expect(plain.tenantId, "two different workspaces").not.toBe(named.tenantId);

  const namedCurrent = await saas(
    journey,
    "the named workspace",
    "GET",
    "/workspaces/current",
    { as: "named" },
  );
  const plainCurrent = await saas(
    journey,
    "the default workspace",
    "GET",
    "/workspaces/current",
    { as: "plain" },
  );
  expect
    .soft(namedCurrent.body, "a given name is saved trimmed")
    .toMatchObject({ name: "Acme Lab" });
  expect
    .soft(plainCurrent.body, "no name gives My workspace")
    .toMatchObject({ name: "My workspace" });

  const plan = await saas(
    journey,
    "the visitor's plan",
    "GET",
    "/tenant/plan",
    { as: "named" },
  );
  expect
    .soft(plan.body, "the workspace is on the free plan, active")
    .toMatchObject({
      current: { _id: free.id, slug: "free" },
      status: "active",
    });
  expect
    .soft(seatsOf.parse(plan.body).seats, "one member, no invitation")
    .toEqual({ members: 1, pendingInvites: 0, occupied: 1 });

  const again = await saas(
    journey,
    "register the same e-mail again",
    "POST",
    "/register",
    {
      as: "anon",
      body: { email: named.email, password: STRONG, name: "Again" },
    },
  );
  expect
    .soft(
      { status: again.status, code: errorCode(again) },
      "a taken e-mail is refused",
    )
    .toEqual({ status: 400, code: "saas.errors.user.email_in_use" });
});

test("the-password-policy-is-checked-before-anything-is-created", async ({
  journey,
}) => {
  await createPlan(journey, "free");
  const email = journey.email("policy");
  const cases = [
    ["seven characters", passwordWith({ length: 7 })],
    ["no uppercase letter", passwordWith({ upper: false })],
    ["no digit", passwordWith({ digit: false })],
    ["no special character", passwordWith({ special: "" })],
    ["a special character outside @$!%*?&", passwordWith({ special: "#" })],
    ["a space", passwordWith({ special: " " })],
  ] as const;
  for (const [label, password] of cases) {
    const attempt = await registrationAttempt(
      journey,
      `register with ${label}`,
      { email, password, name: "Policy" },
    );
    expect.soft(attempt, `${label} is refused`).toEqual({
      status: 400,
      code: "saas.errors.registration.password_policy",
    });
  }
  const eight = await saas(
    journey,
    "register with exactly eight characters",
    "POST",
    "/register",
    {
      as: "anon",
      body: { email, password: passwordWith({ length: 8 }), name: "Policy" },
    },
  );
  expect
    .soft(
      eight.status,
      "eight characters with every rule is accepted, so the earlier refusals created no account",
    )
    .toBe(200);
});

test("registration-needs-a-free-plan-open-to-individuals", async ({
  journey,
}) => {
  const refusal = { status: 409, code: "saas.errors.plan.no_free_plan" };
  const refused = (label: string) =>
    registrationAttempt(journey, label, {
      email: journey.email(label.slice(0, 20)),
      password: STRONG,
      name: "Plan",
    });
  expect
    .soft(await refused("empty catalogue"), "an empty catalogue refuses")
    .toEqual(refusal);

  const paid = await createPlan(journey, "paid", { price: 9 });
  expect(paid.id, "the paid plan is saved").not.toBe("");
  expect
    .soft(
      await refused("only a paid plan"),
      "a paid plan is not a default plan",
    )
    .toEqual(refusal);

  const business = await createPlan(journey, "biz-free", {
    audience: "business",
  });
  expect(business.id, "the business free plan is saved").not.toBe("");
  expect
    .soft(
      await refused("only a business free plan"),
      "a free plan for businesses only is not a default plan",
    )
    .toEqual(refusal);

  const inactive = await createPlan(journey, "off-free", { isActive: false });
  expect(inactive.id, "the inactive free plan is saved").not.toBe("");
  expect
    .soft(
      await refused("only an inactive free plan"),
      "an inactive free plan is not a default plan",
    )
    .toEqual(refusal);

  const second = await createPlan(journey, "second-free", { order: 5 });
  const first = await createPlan(journey, "first-free", { order: 2 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const opensOn = await planRegistrationOpensOn(
      journey,
      "the plan registration opens on",
    );
    if (opensOn === first.id) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const visitor = await register(journey, "ordered");
  const plan = await saas(
    journey,
    "the visitor's plan",
    "GET",
    "/tenant/plan",
    { as: "ordered" },
  );
  expect.soft(visitor.answer.status, "registration answers 200").toBe(200);
  expect(first.id, "first-free, not second-free").not.toBe(second.id);
  expect
    .soft(plan.body, "the lowest-ordered individual free plan is attached")
    .toMatchObject({ current: { _id: first.id } });
});

test("registration-answers-429-past-its-rate-limit", async ({ journey }) => {
  await createPlan(journey, "free");
  const within = [];
  for (let call = 1; call <= 20; call += 1) {
    within.push(await register(journey, `burst-${call}`));
  }
  expect(
    within.map(({ answer, tenantId }) => ({
      status: answer.status,
      registered: tenantId !== "",
    })),
    "the first 20 registrations of the minute answer 200 with a workspace",
  ).toEqual(
    Array.from({ length: 20 }, () => ({ status: 200, registered: true })),
  );

  const body = {
    email: journey.email("past-limit"),
    password: STRONG,
    name: "Past limit",
  };
  const refused = await registrationAttempt(
    journey,
    "the 21st registration of the minute",
    body,
  );
  expect
    .soft(refused, "the 21st registration is refused with 429")
    .toEqual({ status: 429, code: "Too many requests" });

  await journey.restartBackend();
  const after = await saas(
    journey,
    "register the refused e-mail after a backend restart",
    "POST",
    "/register",
    { as: "anon", body },
  );
  expect
    .soft(
      after,
      "the refused call created nothing, and the restart starts a new count",
    )
    .toMatchObject({ status: 200, body: { tenantId: NON_EMPTY_STRING } });
});
